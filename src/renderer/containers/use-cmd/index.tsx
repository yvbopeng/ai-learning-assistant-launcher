import { useCallback, useEffect, useState } from 'react';
import { notification } from 'antd';
import { ActionName, channel, ServiceName } from '../../../main/cmd/type-info';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';

export interface DownloadProgress {
  percent: number;
  status: 'idle' | 'downloading' | 'installing' | 'done';
  message: string;
}

export default function useCmd() {
  const [isInstallWSL, setIsInstallWSL] = useState<boolean>(true);
  const [wslVersion, setWSLVersion] = useState<string>('');
  const [checkingWsl, setCheckingWsl] = useState<boolean>(true);
  const [isInstallObsidian, setIsInstallObsidian] = useState<boolean>(true);
  const [isInstallLMStudio, setIsInstallLMStudio] = useState<boolean>(true);
  const [lmStudioVersionInfo, setLmStudioVersionInfo] = useState<{
    needUpdate: boolean;
    installedVersion: string | null;
    latestVersion: string | null;
  }>({
    needUpdate: false,
    installedVersion: null,
    latestVersion: null,
  });
  const [obsidianVersionInfo, setObsidianVersionInfo] = useState<{
    needUpdate: boolean;
    installedVersion: string | null;
    latestVersion: string | null;
  }>({
    needUpdate: false,
    installedVersion: null,
    latestVersion: null,
  });
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    percent: 0,
    status: 'idle',
    message: '',
  });
  const [loading, setLoading] = useState(false);
  function action(
    actionName: ActionName,
    serviceName: ServiceName,
    vaultId?: string,
  ) {
    if (loading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setLoading(true);
    window.electron.ipcRenderer.sendMessage(
      channel,
      actionName,
      serviceName,
      vaultId,
    );
  }

  const query = useCallback(() => {
    setCheckingWsl(true);
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'WSL');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'obsidianApp');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'lm-studio');
    window.electron.ipcRenderer.sendMessage(
      channel,
      'checkVersion',
      'lm-studio',
    );
    window.electron.ipcRenderer.sendMessage(
      channel,
      'checkVersion',
      'obsidianApp',
    );
  }, [setCheckingWsl]);
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (messageType, data) => {
        console.debug(messageType, data);
        if (messageType === MESSAGE_TYPE.ERROR) {
          notification.error({
            message: data as string,
            placement: 'topRight',
          });
          // 错误时重置下载进度
          setDownloadProgress({ percent: 0, status: 'idle', message: '' });
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const {
            action: actionName,
            service,
            data: payload,
          } = data as MessageData;
          if (actionName === 'query') {
            if (service === 'WSL') {
              setIsInstallWSL(payload.installed);
              setWSLVersion(payload.version);
              setCheckingWsl(false);
            } else if (service === 'obsidianApp') {
              setIsInstallObsidian(payload);
            } else if (service === 'lm-studio') {
              setIsInstallLMStudio(payload);
            }
          } else if (actionName === 'install') {
            if (service === 'WSL') {
              setIsInstallWSL(payload.installed);
              setWSLVersion(payload.version);
              setLoading(false);
            } else if (service === 'obsidianApp') {
              setIsInstallObsidian(payload);
              setLoading(false);
            } else if (service === 'lm-studio') {
              setIsInstallLMStudio(payload);
              setLoading(false);
            }
          } else if (actionName === 'update') {
            if (service === 'WSL') {
              setIsInstallWSL(payload.installed);
              setWSLVersion(payload.version);
              setLoading(false);
            } else if (service === 'lm-studio') {
              if (payload.installedVersion) {
                setLmStudioVersionInfo({
                  needUpdate: payload.needUpdate,
                  installedVersion: payload.installedVersion,
                  latestVersion: payload.latestVersion,
                });
              }
              setLoading(false);
            } else if (service === 'obsidianApp') {
              if (payload.installedVersion) {
                setObsidianVersionInfo({
                  needUpdate: payload.needUpdate,
                  installedVersion: payload.installedVersion,
                  latestVersion: payload.latestVersion,
                });
              }
              setLoading(false);
            }
          } else if (actionName === 'checkVersion') {
            if (service === 'lm-studio') {
              setLmStudioVersionInfo(payload);
            } else if (service === 'obsidianApp') {
              setObsidianVersionInfo(payload);
            }
          }
        } else if (messageType === MESSAGE_TYPE.INFO) {
          notification.success({
            message: data as string,
            placement: 'topRight',
          });
          // 完成后重置下载进度
          setDownloadProgress({ percent: 0, status: 'idle', message: '' });
          query();
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.PROGRESS) {
          notification.success({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.PROGRESS_ERROR) {
          notification.error({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.WARNING) {
          notification.warning({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.DOWNLOAD_PROGRESS) {
          // 下载进度，更新进度状态，不弹窗
          const progressData = data as unknown as DownloadProgress;
          setDownloadProgress(progressData);
        }
      },
    );

    return () => {
      cancel();
    };
  }, [setIsInstallWSL, setIsInstallObsidian, setCheckingWsl, setWSLVersion]);

  useEffect(() => {
    query();
  }, [query]);

  return {
    isInstallWSL,
    isInstallObsidian,
    isInstallLMStudio,
    lmStudioVersionInfo,
    obsidianVersionInfo,
    downloadProgress,
    checkingWsl,
    action,
    loading,
    wslVersion,
  };
}
