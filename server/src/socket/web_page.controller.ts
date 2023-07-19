import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  WSController,
  OnWSConnection,
  Inject,
  OnWSMessage,
  WSEmit,
  OnWSDisConnection,
  App,
} from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { spawn } from 'node:child_process';

// TODO: 其实需要删除无用的房间号，但存放的数据并不大，先不管了....
const ROOM_MAP: Record<string, { userIds: string[] }> = {};

// 写正则就报错，其他由自制脚本生成 (create_proxy_controller.js)
@WSController('/')
export class WebPageSocketController {
  @Inject()
  ctx: Context;
  @App('socketIO')
  socketApp: SocketApplication;

  @OnWSConnection()
  async onConnectionMethod() {
    console.log('onConnectionMethod', this.ctx.id);
  }
  @OnWSDisConnection()
  async onDisConnectionMethod() {
    console.log('onDisConnectionMethod', this.ctx.id);
    const roomId = this.getRoomIdBySocketId(this.ctx.id);
    if (roomId && ROOM_MAP[roomId]) delete ROOM_MAP[roomId];
  }

  // @OnWSMessage('create_room')
  // @WSEmit('create_room_ack')
  // async createRoom(roomName: string) {
  //   if (!roomName)
  //     return {
  //       success: false,
  //       msg: '必须提供房间号',
  //     };
  //   if (ROOM_MAP[roomName])
  //     return {
  //       success: false,
  //       msg: `房间号(${roomName})已存在，不能重复创建`,
  //     };
  //   ROOM_MAP[roomName] = {
  //     userIds: [this.ctx.id],
  //   };
  //   return {
  //     success: true,
  //   };
  // }

  findSocketById(id: string) {
    const allSocket = Object.fromEntries(
      Array.from(this.socketApp.of('/').sockets.entries())
    );
    return allSocket[id];
  }
  findRoomOtherSocket(currentUserId: string) {
    for (const roomId in ROOM_MAP) {
      const userIds = ROOM_MAP[roomId].userIds || [];
      if (!userIds.includes(currentUserId) || userIds.length === 1) continue;
      const targetUserId = userIds.find(id => id !== currentUserId);
      const tgSocket = this.findSocketById(targetUserId);
      if (tgSocket) return tgSocket;
    }
  }
  getRoomIdBySocketId(socketId: string) {
    for (const roomId in ROOM_MAP) {
      const userIds = ROOM_MAP[roomId]?.userIds;
      if (ROOM_MAP[roomId] && !Array.isArray(userIds)) {
        delete ROOM_MAP[roomId];
        continue;
      }
      if (userIds.includes(socketId)) return roomId;
    }
    return '';
  }

  @OnWSMessage('into_room')
  @WSEmit('into_room_ack')
  async intoRoom(roomName: string) {
    if (!roomName)
      return {
        success: false,
        msg: '必须提供房间号',
      };
    if (!ROOM_MAP[roomName]) {
      ROOM_MAP[roomName] = {
        userIds: [this.ctx.id],
      };
      return {
        success: true,
      };
    }
    if (ROOM_MAP[roomName].userIds.length > 1)
      return {
        success: false,
        msg: `房间号(${roomName})已满`, // 只会有 2 个人在房间
      };
    ROOM_MAP[roomName].userIds.push(this.ctx.id);
    // 通知双方可以开始对话
    const userIds = ROOM_MAP[roomName].userIds;
    const allSocket = Object.fromEntries(
      Array.from(this.socketApp.of('/').sockets.entries())
    );
    const peerOneSocket = allSocket[userIds[0]];
    const peerTwoSocket = allSocket[userIds[1]];
    if (!peerOneSocket || !peerTwoSocket)
      return {
        success: false,
        msg: '非预期情况，找不到其中一方的 socket',
      };
    peerOneSocket.emit('create_offer');
    // peerTwoSocket.emit('is_answer');
    return {
      success: true,
    };
  }
  @OnWSMessage('inform_create_answer')
  @WSEmit('inform_create_answer_ack')
  async informCreateAnswer(roomId: string) {
    if (!roomId || !ROOM_MAP[roomId])
      return {
        success: false,
        msg: '房间号找不到',
      };
    if (ROOM_MAP[roomId].userIds.length !== 2)
      return {
        success: false,
        msg: `房间号(${roomId})异常人数`, // 只会有 2 个人在房间
      };
    const answerSocketId = ROOM_MAP[roomId].userIds.find(
      id => id !== this.ctx.id
    );
    const tgSocket = this.findSocketById(answerSocketId);
    if (!answerSocketId || !tgSocket)
      return { success: false, msg: '非预期错误' };
    tgSocket.emit('create_answer');
    return { success: true };
  }

  // @OnWSMessage('all_user')
  // @WSEmit('all_user_ack')
  // async getAllUser() {
  //   const userIds = Array.from(this.socketApp.of('/').sockets.keys());
  //   return JSON.stringify(userIds);
  // }

  // @OnWSMessage('all_room')
  // @WSEmit('all_room_ack')
  // async getAllRoom() {
  //   return Object.keys(ROOM_MAP);
  // }

  @OnWSMessage('send_ice_candidate')
  @WSEmit('send_ice_candidate_ack')
  async sendIceCandidate(...args) {
    const tgSocket = this.findRoomOtherSocket(this.ctx.id);
    if (!tgSocket) return { success: false, msg: '非预期错误' };
    tgSocket.emit('receive_desc', ...args);
    return { success: true };
  }

  @OnWSMessage('send_desc')
  @WSEmit('send_desc_ack')
  async sendDesc(...args) {
    const tgSocket = this.findRoomOtherSocket(this.ctx.id);
    if (!tgSocket) return { success: false, msg: '非预期错误' };
    tgSocket.emit('receive_desc', ...args);
    return { success: true };
  }
}
