<script setup lang="ts">
import type { Socket } from 'socket.io-client';
import { ref, onMounted, reactive, watch } from 'vue';
import { io } from 'socket.io-client';
import { ElMessage } from 'element-plus';

// TODO: 重命名 chat-room

/**
 * 网上找的 stun 服务器，google 肯定有效，其他估计不一定有效:
    stun:stun1.l.google.com:19302
    stun:stun2.l.google.com:19302
    stun:stun3.l.google.com:19302
    stun:stun4.l.google.com:19302
    stun:23.21.150.121
    stun:stun01.sipphone.com
    stun:stun.ekiga.net
    stun:stun.fwdnet.net
    stun:stun.ideasip.com
    stun:stun.iptel.org
    stun:stun.rixtelecom.se
    stun:stun.schlund.de
    stun:stunserver.org
    stun:stun.softjoys.com
    stun:stun.voiparound.com
    stun:stun.voipbuster.com
    stun:stun.voipstunt.com
    stun:stun.voxgratia.org
    stun:stun.xten.com
 */

/**
 * 完整流程：
 *    1. 双方 与服务器建立 socket 连接
 *    2. 双方 输入相同的"房间号"，准备交换信息，先进入房间的创建 Offer(A端)，后进入房间的创建 Answer(B端)
 *    3. 双方 都创建 RTCPeerConnection 实例，通过 onicecandidate 拿到 candidate(会有多个)，此过程可以提前创建
 *    4. A端 createDataChannel 创建数据通道，后续用来发送数据
 *    5. A端 创建 Offer ，会生成 Description ，自己 setLocalDescription ，通过 socket 发送给对端 setRemoteDescription
 *    6. B端 收到 A端 的 Description 后，使用 setRemoteDescription 设置
 *    7. A端 的 onicecandidate 会产出数据，拿到所有的 candidate 后，再通过 socket 依次发给 B端
 *    8. B端 依次收到 candidate 后，使用 addIceCandidate 设置
 *    9. B端 现在可以创建 Answer ，同样会生成 Description 和 candidate ，执行类似上面的步骤，发给 A端 设置
 *    10. A端 设置完后，双方应该会触发 channel 的 onopen 事件
 *    11. 发送数据
 * 
 * // TODO: 关闭 socket 
 * // TODO: 重连 (网络变更)
 * 
 * 注意事项：
 *    1. addIceCandidate 之前必须先 setRemoteDescription
 *    2. Answer端 创建之前，必须先 setRemoteDescription
 * 
 */

const socket = ref<Socket | null>(null);
const socketConnected = ref(false);
const roomId = ref('');
const inRoom = ref(false);
// 角色
const role = ref<'offer' | 'answer' | ''>('');
// RTCPeerConnection
const connectionRef = ref<RTCPeerConnection>();
const channelRef = ref<RTCDataChannel>();
const channelOpened = ref(false);
// const candidateList = reactive<(RTCIceCandidate | null)[]>([]); // TODO:成功建立p2p后清空
// const candidateEnd = ref(false);
// const candidateTimer = ref<number>();
// 数据交互
const channelSendData = ref('');
const dataList = reactive<{ type: 'self' | 'target', msg: string }[]>([]);


// 创建 socket
function initSocket() {
  if (socket.value) return;
  socket.value = io(`ws://${location.host}/`, { autoConnect: true });
  socket.value.on('connect', () => {
    socketConnected.value = true;
    ElMessage.success(`connect: ${socket.value?.connected}`);
  });
  socket.value.on('disconnect', async () => {
    socketConnected.value = false;
    ElMessage.success('socket disconnect');
  });
  socket.value.on('connect_error', async () => {
    socketConnected.value = false;
    ElMessage.error('socket connect_error');
  });

  // 分配角色 (双方进入房间后)
  socket.value.on('set_role', (_role: 'offer' | 'answer') => {
    ElMessage.info(`作为角色: ${_role}`); // TODO:del
    if (!_role || !['offer', 'answer'].includes(_role)) return ElMessage.error(`角色分配异常: ${_role}`);
    role.value = _role;
  });
  // 交换 ice_candidate
  socket.value.on('add_ice_candidate', (candidate: RTCIceCandidate | null) => {
    if (!candidate) return;
    if (!connectionRef.value) return ElMessage.error('缺少 connection');
    connectionRef.value.addIceCandidate(candidate).then(
      () => {
        // console.log(`AddIceCandidate success. (${JSON.stringify(candidate)})`);
      },
      (err) => {
        ElMessage.error(`[Failed to add Ice Candidate]: ${err.toString()} (${JSON.stringify(candidate)})`);
      }
    );
  });
  // 交换 description
  socket.value.on('receive_desc', (desc: RTCSessionDescriptionInit) => {
    if (!desc) return;
    if (!connectionRef.value) return ElMessage.error('缺少 connection');
    connectionRef.value.setRemoteDescription(desc).then(
      () => {
        // console.log(`setRemoteDescription success. (${JSON.stringify(desc)})`);
        // Answer端 需要接收到 Offer端 的 Description 才能开始创建
        if (role.value === 'answer') createAnswer();
      },
      (err) => {
        ElMessage.error(`[Failed to setRemoteDescription]: ${err.toString()} (${JSON.stringify(desc)})`);
      }
    );
  });

  initPeerConnection();
}

// 创建 RTCPeerConnection
function initPeerConnection() {
  // 创建 [WebRTC] 实例
  const connection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
  });
  connectionRef.value = connection
  // 得到 [ICE candidate]
  connectionRef.value.onicecandidate = async (evt: RTCPeerConnectionIceEvent) => {
    // console.log('onicecandidate: ', JSON.stringify(evt)) // TODO:del
    const { candidate } = evt;
    // // 先存放，因为 addIceCandidate 前必须先执行 setRemoteDescription
    // candidateList.push(candidate);

    // TODO: 测试直接发送会不会有问题
    await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_ice_candidate', dataList: [candidate] });
  };
  console.log('connection: ', connectionRef.value)
}

// 创建 Offer 或 Answer
async function createOffer() {
  try {
    if (!connectionRef.value) throw '缺少 connection';
    // 创建[发送通道]
    const sendChannel = connectionRef.value.createDataChannel('stun-channel-2');
    channelRef.value = sendChannel;
    // [发送通道]的事件
    sendChannel.onmessage = onChannelMessage;
    sendChannel.onopen = onChannelStateChange.bind(undefined, sendChannel);
    sendChannel.onclose = onChannelStateChange.bind(undefined, sendChannel);
    // 创建[Offer]
    const desc = await connectionRef.value.createOffer();
    connectionRef.value!.setLocalDescription(desc);
    // 通知对端创建[Answer] 发送[Description]
    await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [desc] });
  } catch (err) {
    ElMessage.error(`[createOffer error]: ${String(err)}`);
  }
}
async function createAnswer() {
  try {
    if (!connectionRef.value) throw '缺少 connection';
    connectionRef.value.ondatachannel = (event) => {
      // 获取[发送通道]
      const receiveChannel = event.channel;
      channelRef.value = receiveChannel;
      // [发送通道]的事件
      receiveChannel.onmessage = onChannelMessage;
      receiveChannel.onopen = onChannelStateChange.bind(undefined, receiveChannel);
      receiveChannel.onclose = onChannelStateChange.bind(undefined, receiveChannel);
    };
    const desc = await connectionRef.value.createAnswer();
    connectionRef.value!.setLocalDescription(desc);
    await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [desc] });
  } catch (err) {
    ElMessage.error(`[createAnswer error]: ${String(err)}`);
  }
}

// 发送数据
function sendChannel() {
  if (!channelRef.value) return ElMessage.error('缺少 channel');
  if (!channelSendData.value) return ElMessage.error('缺少发送数据')
  channelRef.value.send(channelSendData.value);
  dataList.push({ type: 'self', msg: channelSendData.value });
  channelSendData.value = '';
}

// 事件
function onChannelMessage(evt: MessageEvent) {
  ElMessage.info(evt.data);
  dataList.push({ type: 'target', msg: evt.data });
}
function onChannelStateChange(channel: RTCDataChannel) {
  const readyState = channel.readyState;
  ElMessage.info(`Channel state is: ${readyState}`);
  if (readyState === 'open') onChannelOpen();
}
function onChannelOpen() {
  channelOpened.value = true;
  ElMessage.success('数据通道已建立');
  if (!socket.value) return ElMessage.error(`[程序意外错误] 缺少 socket: onChannelOpen`);
  socket.value.close();
  socket.value = null;
}

// 工具函数
function asyncSendSocketData(params: { socket: Socket, event: string, dataList: any[], timeout?: number }) {
  const { socket, event, dataList, timeout, } = params;
  const ackEvent = `${event}_ack`;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      socket.off(ackEvent);
      reject(`socket send timeout (${event})`);
    }, timeout || 2000);
    socket.once(ackEvent, (data: { msg?: string, success: boolean }) => {
      const { success, msg } = data;
      if (!success) return ElMessage.error(msg);
      resolve(data);
    });
    socket.emit(event, ...dataList);
  });
}


async function intoRoom() {
  if (!socket.value) return ElMessage.error('缺少 socket');
  if (!roomId.value) return ElMessage.error('缺少房间号');
  await asyncSendSocketData({ socket: socket.value as any, event: 'into_room', dataList: [roomId.value] }) as any;
  inRoom.value = true;
}



/**
 * 主要是针对创建 offer 的一端
 * 当第一个 candidate 记录时开始计算
 * 多个 candidate 的间隔最大是 1000ms
 * 超时则表示 candidate 收集结束
 * 结束后，陆续发送 candidate 给对端
 */
// watch(() => candidateList, () => {
//   if (!candidateList.length || candidateEnd.value) return;
//   const TIMEOUT = 1000;
//   if (candidateTimer.value) clearTimeout(candidateTimer.value);
//   candidateTimer.value = setTimeout(() => candidateEnd.value = true, TIMEOUT);
// }, { deep: true });
// watch(candidateEnd, async () => {
//   if (!candidateEnd.value) return;
//   for (const candidate of candidateList) {
//     await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_ice_candidate', dataList: [candidate] });
//   }
//   candidateEnd.value = false;
// });

watch(role, () => {
  if (role.value === 'offer') {
    createOffer();
    return;
  }
});


onMounted(initSocket);
</script>

<template>
  <div class="w-full h-full flex flex-col">

    <div>
      <span>room: </span>
      <el-input v-model="roomId" :disabled="inRoom" class="!w-200px" />
      <!-- <el-button @click="createRoom" :disabled="inRoom">创建并进入房间</el-button> -->
      <el-button @click="intoRoom" :disabled="inRoom">进入房间</el-button>
    </div>

    <div>[{{ inRoom ? `已进入 ${roomId} 房间` : '未进入任何房间' }}]</div>
    <div class="flex-1 overflow-auto bg-gray-100">
      <div v-for="item, idx of dataList" :key="idx" :class="`${item.type === 'self' ? 'text-right' : 'text-left'}`">
        <span v-if="item.type === 'target'" class="select-none">[对方]</span>
        <span>{{ item.msg }}</span>
        <span v-if="item.type === 'self'" class="select-none">[自己]</span>
      </div>
    </div>

    <div class="w-full flex">
      <el-input v-model="channelSendData" @keydown.enter="sendChannel" class="!flex-1" />
      <el-button @click="sendChannel" :disabled="!inRoom">发送数据</el-button>
    </div>
  </div>
</template>
