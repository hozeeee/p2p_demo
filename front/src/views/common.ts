import type { Socket } from 'socket.io-client';
import { ref, onMounted, reactive, watch } from 'vue';
import { io } from 'socket.io-client';
import { ElMessage } from 'element-plus';

export function useWebRTC(params: {
    onChannelMessage: ((this: RTCDataChannel, ev: MessageEvent<any>) => any) | null
}) {
    const socket = ref<Socket | null>(null);
    const socketConnected = ref(false);
    const inRoom = ref(false);
    // 角色
    const role = ref<'offer' | 'answer' | ''>('');
    // RTCPeerConnection
    const peerConnectionRef = ref<RTCPeerConnection>();
    const dataChannelRef = ref<RTCDataChannel>();
    const channelOpened = ref(false);

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
            ElMessage.info(`作为角色: ${_role}`);
            if (!_role || !['offer', 'answer'].includes(_role)) return ElMessage.error(`角色分配异常: ${_role}`);
            role.value = _role;
        });
        // 交换 ice_candidate
        socket.value.on('add_ice_candidate', (candidate: RTCIceCandidate | null) => {
            if (!candidate) return;
            if (!peerConnectionRef.value) return ElMessage.error('缺少 connection');
            peerConnectionRef.value.addIceCandidate(candidate).then(
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
            if (!peerConnectionRef.value) return ElMessage.error('缺少 connection');
            peerConnectionRef.value.setRemoteDescription(desc).then(
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
    onMounted(initSocket);

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
        peerConnectionRef.value = connection
        // 得到 [ICE candidate]
        peerConnectionRef.value.onicecandidate = async (evt: RTCPeerConnectionIceEvent) => {
            // console.log('onicecandidate: ', JSON.stringify(evt)) // TODO:del
            const { candidate } = evt;
            await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_ice_candidate', dataList: [candidate] });
        };
        console.log('connection: ', peerConnectionRef.value)
    }

    // 创建 Offer 或 Answer
    async function createOffer() {
        try {
            if (!peerConnectionRef.value) throw '缺少 connection';
            // 创建[发送通道]
            const sendChannel = peerConnectionRef.value.createDataChannel('stun-channel-2');
            dataChannelRef.value = sendChannel;
            // [发送通道]的事件
            sendChannel.onmessage = params.onChannelMessage;
            sendChannel.onopen = onChannelStateChange.bind(undefined, sendChannel);
            sendChannel.onclose = onChannelStateChange.bind(undefined, sendChannel);
            // 创建[Offer]
            const desc = await peerConnectionRef.value.createOffer();
            peerConnectionRef.value!.setLocalDescription(desc);
            // 通知对端创建[Answer] 发送[Description]
            await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [desc] });
        } catch (err) {
            ElMessage.error(`[createOffer error]: ${String(err)}`);
        }
    }
    async function createAnswer() {
        try {
            if (!peerConnectionRef.value) throw '缺少 connection';
            peerConnectionRef.value.ondatachannel = (event) => {
                // 获取[发送通道]
                const receiveChannel = event.channel;
                dataChannelRef.value = receiveChannel;
                // [发送通道]的事件
                receiveChannel.onmessage = params.onChannelMessage;
                receiveChannel.onopen = onChannelStateChange.bind(undefined, receiveChannel);
                receiveChannel.onclose = onChannelStateChange.bind(undefined, receiveChannel);
            };
            const desc = await peerConnectionRef.value.createAnswer();
            peerConnectionRef.value!.setLocalDescription(desc);
            await asyncSendSocketData({ socket: socket.value as Socket, event: 'send_desc', dataList: [desc] });
        } catch (err) {
            ElMessage.error(`[createAnswer error]: ${String(err)}`);
        }
    }

    // 发送数据
    function dataChannelSend(sendData: string | Blob | ArrayBuffer | ArrayBufferView) {
        if (!dataChannelRef.value) return ElMessage.error('缺少 channel');
        dataChannelRef.value.send(sendData as any);
    }

    // 事件
    // function onChannelMessage(evt: MessageEvent) {
    //     ElMessage.info(evt.data);
    //     dataList.push({ type: 'target', msg: evt.data });
    // }
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


    async function intoRoom(roomId: string) {
        if (!socket.value) return ElMessage.error('缺少 socket');
        if (!roomId) return ElMessage.error('缺少房间号');
        await asyncSendSocketData({ socket: socket.value as any, event: 'into_room', dataList: [roomId] }) as any;
        inRoom.value = true;
    }

    watch(role, () => {
        if (role.value === 'offer') {
            createOffer();
            return;
        }
    });


    return {
        socketConnected,
        intoRoom,
        inRoom,
        dataChannelSend,
        channelOpened,
    }
}
