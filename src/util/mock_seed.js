/* 
  What is it?
    当Torrent种子非常慢的时候，使用该脚本本地模拟一个做种的情况
  How to use it?
    下载依赖
    npm install 
    启动本地做种
    node src/util/mock_seed.js

*/

import WebTorrent from 'webtorrent';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new WebTorrent({ dht: true, lsd: true, utPex: true });

// 把本地文件做成种子
client.seed(
    path.join(__dirname, '../../__mocks__/seed_file_demo.txt'),
    { announceList: [['ws://127.0.0.1:8000']] },
    torrent => {
        console.log('[seed] 种子已生成');
        console.log('[seed] infoHash :', torrent.infoHash);
        console.log('[seed] magnetURI :\n', torrent.magnetURI);

        torrent.on('wire', (wire, addr) =>
            console.log(`[seed] 上传给 -> ${addr}（${wire.type}）`)
        );
    }
);