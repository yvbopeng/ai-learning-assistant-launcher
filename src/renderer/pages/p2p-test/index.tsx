import { Button, Input } from 'antd';
import { useEffect, useState } from 'react';
import { DLCIndex } from '../../../main/dlc/type-info';

export default function P2PTest() {
  const [dLCIndex, setDLCIndex] = useState<DLCIndex>([]);
  useEffect(() => {
    window.mainHandle
      .queryWebtorrentHandle()
      .then((newDLCIndex) => setDLCIndex(newDLCIndex));
  }, []);
  return (
    <div>
      {dLCIndex.map((dlc) => {
        const versions = [];
        for (const key in dlc.versions) {
          versions.push(
            <Button
              onClick={() =>
                window.mainHandle.startWebtorrentHandle(dlc.versions[key])
              }
            >
              下载{dlc.name}
              {key}
            </Button>,
          );
        }
        return versions;
      })}
    </div>
  );
}
