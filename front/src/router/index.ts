import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import ChatRoom from '../views/ChatRoom.vue'
import FileSender from '../views/FileSender.vue'

export const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView
  },
  {
    path: '/chat_room',
    name: 'chat_room',
    component: ChatRoom,
  },
  {
    path: '/file_sender',
    name: 'file_sender',
    component: FileSender,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
