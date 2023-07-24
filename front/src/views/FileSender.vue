<script setup lang="ts">
import type { UploadInstance, UploadProps, UploadRawFile, UploadFile } from 'element-plus'
import { ref } from 'vue';
import genMd5 from 'blueimp-md5';
import { genFileId, ElMessage } from 'element-plus';
import { useWebRTC } from './common';
const CHUNK_SIZE = 16 * 1024; // 切片大小

const roomId = ref('');
const {
    socketConnected,
    intoRoom,
    inRoom,
    dataChannelSend,
    channelOpened,
} = useWebRTC({ onChannelMessage });
const uploadEl = ref<UploadInstance>();
const file = ref<UploadRawFile>();
const fileOffset = ref(0);

const onUploadExceed = (files: File[]) => {
    uploadEl.value!.clearFiles()
    const _file = files[0] as UploadRawFile;
    _file.uid = genFileId();
    uploadEl.value!.handleStart(_file)
    file.value = _file;
}
function onUploadChange(_file: UploadFile) {
    file.value = _file.raw;
}
function onChannelMessage(evt: MessageEvent) {
    ElMessage.info(evt.data);
    // dataList.push({ type: 'target', msg: evt.data });
}

function sendFile() {
    if (!file.value) return; // TODO:err
    const fileSize = file.value?.size;
    const fileReader = new FileReader();
    fileOffset.value = 0;
    fileReader.addEventListener('error', error => console.error('Error reading file:', error));
    fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
    fileReader.addEventListener('load', e => {
        console.log('FileRead.onload ', e, typeof e.target?.result, e.target?.result,);
        if (!e.target?.result) return; // TODO:err
        dataChannelSend(e.target.result);
        const md5 = genMd5(e.target.result.toString());
        fileOffset.value += e.target.result.byteLength;
        if (fileOffset.value < fileSize) {
            readSlice(fileOffset.value);
        }
    });
    const readSlice = (o: number) => {
        console.log('readSlice ', o);
        const slice = file.value!.slice(fileOffset.value, o + CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };
    readSlice(0);
}

console.log(genMd5)

</script>

<template>
    <div class="w-full h-full">
        <el-upload ref="uploadEl" :limit="1" :on-change="onUploadChange" :on-exceed="onUploadExceed" :auto-upload="false">
            <template #trigger>
                <el-button type="primary">select file ({{ (file?.size || 0) / 1024 / 1024 }}MB)</el-button>
            </template>
        </el-upload>
        <div>
            <span>room: </span>
            <el-input v-model="roomId" :disabled="inRoom" class="!w-200px" />
            <el-button @click="intoRoom(roomId)" :disabled="inRoom || !socketConnected">进入房间</el-button>
        </div>
        <div>
            <el-button @click="sendFile" :disabled="!channelOpened">发送文件</el-button>
        </div>
    </div>
</template>
