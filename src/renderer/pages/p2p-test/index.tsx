import { Button } from 'antd';
import { useState } from 'react';
import WebTorrent from 'webtorrent';
const client = new WebTorrent();

const url =
  'magnet:?xt=urn:btih:f9b78a4446db8ca74f89fd973b35a6eec497b55d&dn=p2p-demo.mp4&tr=ws%3A%2F%2F121.40.137.135%3A8200';

export default function P2PTest() {
  const [files, setFiles] = useState<File[]>([]);
  function download() {
    client.add(url, (torrent) => {
      // Got torrent metadata!
      console.log('Client is downloading:', torrent.infoHash);

      for (const file of torrent.files) {
        setFiles([...files, file]);
      }
    });
  }
  return (
    <div>
      <Button onClick={download}>下载</Button>
      {files.map((file) => (
        <div key={file.name}>{file.name}</div>
      ))}
    </div>
  );
}
