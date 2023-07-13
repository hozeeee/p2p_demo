import { Controller, Get } from '@midwayjs/core';
import fs from 'node:fs';
import { join } from 'node:path';

@Controller('/')
export class HomeController {
  @Get('/')
  async home(): Promise<string> {
    // const html = fs.readFileSync(join(__dirname, 'index.html')).toString();
    // return html;
    return 'is-work';
  }
}
