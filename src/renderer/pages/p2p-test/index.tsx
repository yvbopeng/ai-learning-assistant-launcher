import { Button, Input } from 'antd';
import { useEffect, useState } from 'react';
import { DLCIndex } from '../../../main/dlc/type-info';

export default function P2PTest() {
  const [dLCIndex, setDLCIndex] = useState<DLCIndex>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(1);
  useEffect(() => {
    window.mainHandle
      .queryWebtorrentHandle()
      .then((newDLCIndex) => setDLCIndex(newDLCIndex));
    const timeout = setTimeout(
      () => setRefreshTrigger(refreshTrigger + 1),
      1000,
    );
    return () => {
      clearTimeout(timeout);
    };
  }, [refreshTrigger, setRefreshTrigger]);
  return (
    <table>
      {dLCIndex.map((dlc) => {
        const versions = [];
        for (const key in dlc.versions) {
          versions.push(
            <tr>
              <td>
                {dlc.name}
                {key}
              </td>
              <td>
                <textarea>
                  {JSON.stringify(dlc.versions[key].progress, null, 2)}
                </textarea>
              </td>
              <td>
                <Button
                  onClick={() =>
                    window.mainHandle.startWebtorrentHandle(
                      dlc.versions[key].magnet,
                    )
                  }
                >
                  下载
                </Button>
                <Button
                  onClick={() =>
                    window.mainHandle.pauseWebtorrentHandle(
                      dlc.versions[key].magnet,
                    )
                  }
                >
                  暂停
                </Button>
                <Button
                  onClick={() =>
                    window.mainHandle.removeWebtorrentHandle(
                      dlc.versions[key].magnet,
                    )
                  }
                >
                  删除
                </Button>
              </td>
            </tr>,
          );
        }
        return versions;
      })}
    </table>
  );
}
