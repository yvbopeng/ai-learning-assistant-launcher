import { Button, Input } from 'antd';
import { useState } from 'react';
import WebTorrent from 'webtorrent';
const client = new WebTorrent({
  dht: true,      // 开启 DHT
  lsd: true,      // 开启本地服务发现
  utPex: true     // 开启 PEX
});

const url_remote =
  'magnet:?xt=urn:btih:f9b78a4446db8ca74f89fd973b35a6eec497b55d&dn=p2p-demo.mp4&tr=ws%3A%2F%2F121.40.137.135%3A8200';

type FileItem = { name: string; blob: Blob }

const save = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const mock_dom_element_for_download = document.createElement('a');
  mock_dom_element_for_download.href = url;
  mock_dom_element_for_download.download = name;
  mock_dom_element_for_download.click();
  URL.revokeObjectURL(url);
}

export default function P2PTest() {
  const [files, setFiles] = useState<FileItem[]>([]);
  // ! 这里初始化的值为测试的做种地址，正式功能需要改动初始化
  const [url, setUrl] = useState(url_remote);

  function download() {
    client.on('error', e => console.log('[client] error:', e.message))

    client.on('torrent', (torrent) => {
      console.log('[torrent] 新增种子:', torrent.infoHash);

      torrent.on('download', () => {
        const progressPercent = (torrent.progress * 100).toFixed(2);
        const downloadedMB = (torrent.downloaded / 1024 / 1024).toFixed(2);
        const totalMB = (torrent.length / 1024 / 1024).toFixed(2);
        console.log(
          `\r📥 下载进度：${downloadedMB} MB / ${totalMB} MB (${progressPercent}%)`
        );
      });

      torrent.on('done', async () => {
        console.log('\n✅ 下载完成');

        const items: FileItem[] = [];
        for (const file of torrent.files) {
          const blob = await file.blob();
          items.push({ name: file.name, blob });
        }
        setFiles(items)
      });
    });

    client.add(url, (torrent) => {
      // Got torrent metadata!
      console.log('Client is downloading:', torrent.infoHash);
      console.log(`[add] 开始下载 ${torrent.name}`)
      for (const file of torrent.files) {
        setFiles([...files, file]);
      }
    });
  }
  return (
    <div>
      {/* TODO 增加一个输入框，用来更新 url 这个变量触发下载 */}
      <Input
        placeholder="请输入magnet链接"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ width: '400px', marginRight: '8px' }}
      />

      <Button onClick={download}>下载</Button>
      {files.map((file) => (
        <div key={file.name}>
          <span>{file.name}</span>
          <button onClick={() => save(file.name, file.blob)}>
            保存到本地
          </button>
        </div>
      ))}
    </div>
  );
}
