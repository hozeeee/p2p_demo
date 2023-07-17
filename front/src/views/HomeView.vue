<script setup lang="ts">
import type { Socket } from 'socket.io-client';
import { ref, onMounted } from 'vue';
import { io } from 'socket.io-client';
import { ElMessage } from 'element-plus';

const socket = ref<Socket | null>(null);
const socketConnected = ref(false);
const roomId = ref('');
const inRoom = ref(false);
const otherInRoom = ref(false);
const channelData = ref('');


console.log('location.host: ', location.host)


function initSocket() {
  if (!socket.value) {
    socket.value = io(`ws://${location.host}/`, { autoConnect: false });
    socket.value.on('connect', () => {
      socketConnected.value = true;
      console.log(`connect: ${socket.value?.connected}`); // true
    });
    socket.value.on('disconnect', async () => {
      socketConnected.value = false;
      // await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      // console.log(`[${dateFormatter()}]尝试重连...`);
      // socket.value.connect();
    });
    socket.value.on('connect_error', async () => {
      socketConnected.value = false;
      // await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      // socket.value.connect();
    });

    socket.value.on('other_into_room', () => {
      otherInRoom.value = true;
      ElMessage.success('其他人进入房间了');

      initPeerConnection();
    });

    socket.value.on('add_ice_candidate', (candidate: RTCIceCandidate | null) => {
      console.log('接收到对端的 candidate: ', JSON.stringify(candidate))
      // if (!candidate) return;
      if (!connectionRef.value) return ElMessage.error('缺少 connection');
      connectionRef.value.addIceCandidate(candidate!).then(
        () => console.log('AddIceCandidate success.'),
        (err) => console.log('[Failed to add Ice Candidate]: ' + err.toString())
      );
    });

    socket.value.on('receive_desc', (desc: RTCSessionDescriptionInit) => {
      console.log('接收到对端的 desc: ', desc)
      if (!desc) return;
      if (!connectionRef.value) return ElMessage.error('缺少 connection');
      connectionRef.value.setRemoteDescription(desc).then(
        () => console.log('setRemoteDescription success.'),
        (err) => console.log('[Failed to setRemoteDescription]:' + err.toString())
      );
    });

  }
  socket.value.connect();
}
onMounted(initSocket);

function getAllUser() {
  if (!socket.value) return;
  socket.value.once('all_user_ack', (data) => {
    console.log('all_user_ack: ', data)
  })
  socket.value.emit('all_user')
}

function getAllRoom() {
  if (!socket.value) return;
  socket.value.once('all_room_ack', (data) => {
    console.log('all_room_ack: ', data)
  })
  socket.value.emit('all_room')
}


function createRoom() {
  if (!socket.value) return;
  if (!roomId.value) return ElMessage.error('缺少房间号');
  socket.value.once('create_room_ack', (data) => {
    console.log('create_room_ack: ', data)
    const { success, msg } = data;
    if (!success) return ElMessage.error(msg);
    inRoom.value = true;
  });
  socket.value.emit('create_room', roomId.value);
}

function intoRoom() {
  if (!socket.value) return;
  if (!roomId.value) return ElMessage.error('缺少房间号');
  socket.value.once('into_room_ack', (data) => {
    console.log('into_room_ack: ', data)
    const { success, msg } = data;
    if (!success) return ElMessage.error(msg);
    inRoom.value = true;
  });
  socket.value.emit('into_room', roomId.value);
}


// 初始化 RTCPeerConnection
const connectionRef = ref<RTCPeerConnection>();
const channelRef = ref<RTCDataChannel>();
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
    console.log('onicecandidate: ', evt)
    // TODO: print
    // 发送给对端 connectionRef.value.addIceCandidate
    if (!socket.value) return ElMessage.error('socket 未初始化');
    const { candidate } = evt;
    // 对端监听 add_ice_candidate
    socket.value.emit('send_ice_candidate', candidate);
    // TODO: log   once
  };
  console.log('connection: ', connectionRef.value)

  /** 
   * 1. 创建 [offer] 拿到 [desc] 内容，调用 setLocalDescription
   * 2. 将 [desc] 提供给对端，调用 setRemoteDescription
   * 3. 对端创建 [answer] 之后同样执行上两步的"交换 desc"
   */
}

const offerCreated = ref(false);
const answerCreated = ref(false);
const localDescription = ref<RTCSessionDescriptionInit>();
function createOffer() {
  if (!connectionRef.value) return ElMessage.error('缺少 connection')

  // 创建[发送通道]
  const sendChannel = connectionRef.value.createDataChannel('stun-channel-2');
  channelRef.value = sendChannel;
  console.log('sendChannel: ', sendChannel)
  // [发送通道]的事件
  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onclose = onSendChannelStateChange;
  function onSendChannelStateChange() {
    const readyState = sendChannel.readyState;
    console.log('Send channel state is: ' + readyState); // TODO: print
    if (readyState === 'open') {
      //
    } else {
      //
    }
  }

  connectionRef.value.createOffer().then(
    (desc) => {
      console.log('[Offer from localConnection]: ', desc, connectionRef.value);
      // TODO: 是否需要等 onicecandidate 都结束？
      connectionRef.value!.setLocalDescription(desc);
      localDescription.value = desc;
      offerCreated.value = true;
    },
    (error) => { console.log('[Failed to create session description]: ' + error.toString()) }
  );
}
function createAnswer() {
  if (!connectionRef.value) return ElMessage.error('缺少 connection')

  connectionRef.value.ondatachannel = (event) => {
    console.log('Receive Channel Callback');
    const receiveChannel = event.channel;
    receiveChannel.onmessage = (event) => {
      console.log('Received Message', event.data);
      ElMessage.info(event.data);
      ElMessage.info(JSON.stringify(event.data))
    };
    receiveChannel.onopen = onReceiveChannelStateChange;
    receiveChannel.onclose = onReceiveChannelStateChange;
    function onReceiveChannelStateChange() {
      const readyState = receiveChannel.readyState;
      console.log(`Receive channel state is: ${readyState}`);
    }
  };

  connectionRef.value.createAnswer().then(
    (desc) => {
      console.log('[Answer from localConnection]: ', desc, connectionRef.value);
      connectionRef.value!.setLocalDescription(desc);
      localDescription.value = desc;
      answerCreated.value = true;
    },
    (error) => { console.log('[Failed to create session description]: ' + error.toString()) }
  );
}
function sendDesc() {
  if (!socket.value) return ElMessage.error('socket 未初始化');
  if (!localDescription.value) return ElMessage.error('缺少 localDescription');
  socket.value.emit('send_desc', localDescription.value);
}

function sendChannel() {
  if (!channelRef.value) return ElMessage.error('缺少 channelRef');
  if (!channelData.value) return ElMessage.error('缺少发送数据')
  channelRef.value.send(channelData.value);
}

</script>

<template>
  <div class="w-full h-full">

    <el-button @click="getAllUser">获取所有用户</el-button>
    <el-button @click="getAllRoom">获取所有房间</el-button>

    <div>
      <span>room: </span>
      <el-input v-model="roomId" :disabled="inRoom" class="!w-200px" />
      <el-button @click="createRoom" :disabled="inRoom">创建并进入房间</el-button>
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
