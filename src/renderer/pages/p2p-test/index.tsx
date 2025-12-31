import { Button, Input } from 'antd';

export default function P2PTest() {
  return (
    <div>
      <Button
        onClick={() =>
          window.mainHandle.startWebtorrentHandle('LMSTUDIO_WINDOWS')
        }
      >
        下载
      </Button>
    </div>
  );
}
