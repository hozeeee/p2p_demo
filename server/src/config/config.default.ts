import { MidwayConfig } from '@midwayjs/core';
import { join } from 'node:path';

export default {
  // use for cookie sign key, should change to your own and keep security
  keys: '1689217252958_1429',
  koa: {
    port: 7001,
  },
  staticFile: {
    dirs: {
      default: {
        prefix: '/',
        alias: {
          '/': 'index.html',
        },
        dir: join(__dirname, '../../publish'),
      },
    },
  },
} as MidwayConfig;
