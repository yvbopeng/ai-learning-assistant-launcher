/* 
  Use example
    const local_Seed_URI = 'magnet:?xt=urn:btih:09838ce40a2d644692ca05a59afa77dfec47ee4d&dn=demo.txt&tr=ws%3A%2F%2F127.0.0.1%3A8000'
    const download_path = 'download' // 下载目录
    downloadTorrent(local_Seed_URI, download_path)

*/

import WebTorrent  from 'webtorrent'
import path from 'path';
import { app } from 'electron';

console.log('[WebTorrent] 导入结果：', WebTorrent , typeof WebTorrent );

const defaultPath = path.join(app.getPath('home'), 'Downloads');

function downloadTorrent(magnetURI, downloadPath = defaultPath) {
    const client = new WebTorrent(
        {
            dht: true,      // 开启 DHT
            lsd: true,      // 开启本地服务发现
            utPex: true     // 开启 PEX
        }
    )

    client.on('error', e => console.log('[client] error:', e.message))

    // 触发Torrent下载
    client.on('add', torrent => {
        torrent.on('noPeers', announceType => {
            console.log(`[noPeers] ${announceType} 没找到任何同伴`)
        })

        torrent.on('wire', (wire, addr) => {
            console.log(`[wire] 连上节点 ${addr}（协议 ${wire.type}）`)
        })
        torrent.on('done', () => {
            console.log('torrent download finished')
            /* 
                下载完成后，调用 destroy 方法销毁客户端，
                这通常表现为任务结束后进程会结束然后看到
                命令行提示符
            */
            client.destroy()
        })
    })

    // 开始下载
    client.add(magnetURI, { path: downloadPath}, torrent => {
        // 或许可以做点什么
        console.log(`[add] 开始下载 ${torrent.name} 到 ${downloadPath}`)
    })
}

export default downloadTorrent