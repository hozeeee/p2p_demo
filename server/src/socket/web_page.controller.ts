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
const ROME_MAP: Record<string, {
  userIds: string[]
}> = {};

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
  }

  @OnWSMessage('create_room')
  @WSEmit('create_room_ack')
  async createRoom(roomName: string) {
    if (!roomName)
      return {
        success: false,
        msg: '必须提供房间号',
      };
    if (ROME_MAP[roomName])
      return {
        success: false,
        msg: `房间号(${roomName})已存在，不能重复创建`,
      };
    ROME_MAP[roomName] = {
      userIds: [this.ctx.id],
    };
    return {
      success: true,
    };
  }

  findSocketById(id: string) {
    const allSocket = Object.fromEntries(
      Array.from(this.socketApp.of('/').sockets.entries())
    );
    return allSocket[id];
  }

  @OnWSMessage('into_room')
  @WSEmit('into_room_ack')
  async intoRoom(roomName: string) {
    if (!roomName)
      return {
        success: false,
        msg: '必须提供房间号',
      };
    if (!ROME_MAP[roomName] || !ROME_MAP[roomName].userIds?.length)
      return {
        success: false,
        msg: `房间号(${roomName})不存在，请先创建`,
      };
    if (ROME_MAP[roomName].userIds.length > 1)
      return {
        success: false,
        msg: `房间号(${roomName})已满`, // 只会有 2 个人在房间
      };
    ROME_MAP[roomName].userIds.push(this.ctx.id);
    // 通知双方可以开始对话
    const userIds = ROME_MAP[roomName].userIds;
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
    peerOneSocket.emit('other_into_room');
    peerTwoSocket.emit('other_into_room');
    return {
      success: true,
    };
  }

  @OnWSMessage('all_user')
  @WSEmit('all_user_ack')
  async getAllUser() {
    const userIds = Array.from(this.socketApp.of('/').sockets.keys());
    return JSON.stringify(userIds);
  }

  @OnWSMessage('all_room')
  @WSEmit('all_room_ack')
  async getAllRoom() {
    return Object.keys(ROME_MAP);
  }

  @OnWSMessage('send_ice_candidate')
  async sendIceCandidate(...args) {
    console.log('args: ', args)
    const currentUserId = this.ctx.id;
    for (const roomId in ROME_MAP) {
      const userIds = ROME_MAP[roomId].userIds || [];
      if (!userIds.includes(currentUserId) || userIds.length === 1) continue;
      const targetUserId = userIds.find(id => id !== currentUserId);
      const tgSocket = this.findSocketById(targetUserId);
      tgSocket.emit('add_ice_candidate', ...args);
    }
    // TODO: 提示发送成功
  }

  @OnWSMessage('send_desc')
  async sendDesc(...args) {
    const currentUserId = this.ctx.id;
    for (const roomId in ROME_MAP) {
      const userIds = ROME_MAP[roomId].userIds || [];
      if (!userIds.includes(currentUserId) || userIds.length === 1) continue;
      const targetUserId = userIds.find(id => id !== currentUserId);
      const tgSocket = this.findSocketById(targetUserId);
      tgSocket.emit('receive_desc', ...args);
    }
    // TODO: 提示发送成功
  }
}
