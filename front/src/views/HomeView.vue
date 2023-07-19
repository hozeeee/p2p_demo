<script setup lang="ts">
import type { Socket } from 'socket.io-client';
import { ref, onMounted, reactive, watch } from 'vue';
import { io } from 'socket.io-client';
import { ElMessage } from 'element-plus';

const socket = ref<Socket | null>(null);
const socketConnected = ref(false);
const roomId = ref('');
const inRoom = ref(false);
const otherInRoom = ref(false);
const channelData = ref('');
// 初始化 RTCPeerConnection
const connectionRef = ref<RTCPeerConnection>();
const channelRef = ref<RTCDataChannel>();
const candidateList = reactive<(RTCIceCandidate | null)[]>([]); // TODO:成功建立p2p后清空


console.log('location.host: ', location.host)


function initSocket() {
  // socket.value.connect();
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
  // 成功匹配房间号后，分别创建 offer 和 answer
  socket.value.on('create_offer', createOffer);
  socket.value.on('create_answer', createAnswer);
  // 交换 ice_candidate
  socket.value.on('add_ice_candidate', (candidate: RTCIceCandidate | null) => {
    console.log('接收到对端的 candidate: ', JSON.stringify(candidate))
    // if (!candidate) return;
    if (!connectionRef.value) return ElMessage.error('缺少 connection');
    connectionRef.value.addIceCandidate(candidate!).then(
      () => console.log('AddIceCandidate success.'),
      (err) => console.log('[Failed to add Ice Candidate]: ' + err.toString())
    );
  });
  // 交换 description
  socket.value.on('receive_desc', (desc: RTCSessionDescriptionInit) => {
    console.log('接收到对端的 desc: ', desc)
    if (!desc) return;
    if (!connectionRef.value) return ElMessage.error('缺少 connection');
    connectionRef.value.setRemoteDescription(desc).then(
      () => console.log('setRemoteDescription success.'),
      (err) => console.log('[Failed to setRemoteDescription]:' + err.toString())
    );
  });

  initPeerConnection();
}
onMounted(initSocket);

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
  connectionRef.value.onicecandidate = (evt: RTCPeerConnectionIceEvent) => {
    console.log('onicecandidate: ', evt) // TODO:del
    const { candidate } = evt;
    // 先存放，因为 addIceCandidate 前必须先执行 setRemoteDescription
    candidateList.push(candidate);
  };
  console.log('connection: ', connectionRef.value)

  /** 
   * 1. 创建 [offer] 拿到 [desc] 内容，调用 setLocalDescription
   * 2. 将 [desc] 提供给对端，调用 setRemoteDescription
   * 3. 对端创建 [answer] 之后同样执行上两步的"交换 desc"
   */
}

function onChannelMessage(evt: MessageEvent) {
  console.log('Received Message', evt.data);
  ElMessage.info(evt.data);
  ElMessage.info(JSON.stringify(evt.data))
}
function onChannelStateChange(channel: RTCDataChannel) {
  const readyState = channel.readyState;
  console.log(`Channel state is: ${readyState}`);
}
function onSocketAck(data: { msg?: string, success: boolean }) {
  const { success, msg } = data;
  if (!success) return ElMessage.error(msg);
  inRoom.value = true;
}
function asyncSendSocketData(params: { socket: Socket, event: string, dataList: any[], timeout?: number }) {
  const { socket, event, dataList, timeout, } = params;
  const ackEvent = `${event}_ack`;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      socket.off(ackEvent);
      reject(`socket send timeout (${event})`);
    }, timeout || 2000);
    socket.once(ackEvent, (data) => {
      onSocketAck(data);
      resolve(data);
    });
    socket.emit(event, ...dataList);
  });
}


// function createRoom() {
//   if (!socket.value) return;
//   if (!roomId.value) return ElMessage.error('缺少房间号');
//   socket.value.once('create_room_ack', onSocketAck);
//   socket.value.emit('create_room', roomId.value);
// }

function intoRoom() {
  if (!socket.value) return;
  if (!roomId.value) return ElMessage.error('缺少房间号');
  socket.value.once('into_room_ack', onSocketAck);
  socket.value.emit('into_room', roomId.value);
}



const offerCreated = ref(false);
const answerCreated = ref(false);
const localDescription = ref<RTCSessionDescriptionInit>();


async function createOffer() {
  try {
    if (!connectionRef.value) throw '缺少 connection';
    // 创建[发送通道]
    const sendChannel = connectionRef.value.createDataChannel('stun-channel-2');
    channelRef.value = sendChannel;
    console.log('channel: ', sendChannel)
    // [发送通道]的事件
    sendChannel.onmessage = onChannelMessage;
    sendChannel.onopen = onChannelStateChange.bind(undefined, sendChannel);
    sendChannel.onclose = onChannelStateChange.bind(undefined, sendChannel);
    // 创建[Offer]
    const desc = await connectionRef.value.createOffer();
    connectionRef.value!.setLocalDescription(desc);
    // 通知对端创建[Answer] 发送[Description]


    console.log('xxxx: 发送 offer-desc (开始)')
    await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [desc] });
    console.log('xxxx: 发送 offer-desc (结束)')
    localDescription.value = desc;
    offerCreated.value = true;

    // await sendDesc();

    // await new Promise(resolve => setTimeout(resolve, 5 * 1000));
    // 通知对端，创建[Answer]
    if (!socket.value) throw '缺少 socket';
    await asyncSendSocketData({ socket: socket.value as Socket, event: 'inform_create_answer', dataList: [roomId.value] });
    // socket.value.once('inform_create_answer_ack', onSocketAck);
    // socket.value.emit('inform_create_answer', roomId.value);
  } catch (err) {
    console.error(`[createOffer error]: ${String(err)}`);
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
      console.log('channel: ', receiveChannel)
      // [发送通道]的事件
      receiveChannel.onmessage = onChannelMessage;
      receiveChannel.onopen = onChannelStateChange.bind(undefined, receiveChannel);
      receiveChannel.onclose = onChannelStateChange.bind(undefined, receiveChannel);
    };

    const desc = await connectionRef.value.createAnswer();
    console.log('[Answer from localConnection]: ', desc, connectionRef.value);
    connectionRef.value!.setLocalDescription(desc);

    console.log('xxxx: 发送 answer-desc (开始)')
    await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [desc] });
    console.log('xxxx: 发送 answer-desc (结束)')
    localDescription.value = desc;
    answerCreated.value = true;

  } catch (err) {
    console.error(`[createAnswer error]: ${String(err)}`);
    ElMessage.error(`[createAnswer error]: ${String(err)}`);
  }
}
async function sendDesc() {
  if (!socket.value) return ElMessage.error('socket 未初始化');
  if (!localDescription.value) return ElMessage.error('缺少 localDescription');
  // 对端必须先设置了 description 才能正常设置 candidate
  // socket.value.emit('send_desc', localDescription.value);
  await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [localDescription.value] });
  // for (const candidate of candidateList) {
  //   // socket.value.emit('send_ice_candidate', candidate);
  //   await asyncSendSocketData({ socket: socket.value as Socket, sendEventName: 'send_ice_candidate', ackEventName: 'send_ice_candidate_ack', data: candidate });
  // }
  console.log('candidateList: ', candidateList)
}
watch([() => candidateList, localDescription], async () => {
  if (!localDescription.value || !candidateList.length) return;
  const candidate = candidateList[0];
  console.log('xxxx: 发送 candidate', candidateList.length)
  await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_ice_candidate', dataList: [candidate] });
  candidateList.shift();
}, { deep: true });

function sendChannel() {
  if (!channelRef.value) return ElMessage.error('缺少 channelRef');
  if (!channelData.value) return ElMessage.error('缺少发送数据')
  channelRef.value.send(channelData.value);
}

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

</script>

<template>
  <div class="w-full h-full">

    <div>
      <span>room: </span>
      <el-input v-model="roomId" :disabled="inRoom" class="!w-200px" />
      <!-- <el-button @click="createRoom" :disabled="inRoom">创建并进入房间</el-button> -->
      <el-button @click="intoRoom" :disabled="inRoom">进入房间</el-button>
    </div>

    <div>[{{ inRoom ? `已进入 ${roomId} 房间` : '未进入任何房间' }}]</div>

    <div>
      <el-button @click="createOffer" :disabled="!inRoom">创建 offer</el-button>
      <el-button @click="createAnswer" :disabled="!inRoom">创建 answer</el-button>
      <el-button @click="sendDesc" :disabled="!localDescription">发送给对方 desc</el-button>
    </div>

    <div>
      <el-input v-model="channelData" class="!w-200px" />
      <el-button @click="sendChannel" :disabled="!inRoom">发送数据</el-button>
    </div>
  </div>
</template>
