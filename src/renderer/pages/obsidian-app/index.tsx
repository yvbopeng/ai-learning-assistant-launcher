import { useCallback } from 'react';
import { Button, List, Skeleton, Badge, Space, Progress } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import { channel } from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';

export default function ObsidianApp() {
  const {
    isInstallObsidian,
    obsidianVersionInfo,
    downloadProgress,
    action: cmdAction,
    loading: cmdLoading,
  } = useCmd();
  const {
    obsidianConfig,
    obsidianVaultConfig,
    action: configsAction,
    loading: configsLoading,
  } = useConfigs();

  return (
    <div className="obsidian-app">
      <List
        className="obsidian-app-list"
        header={
          <div className="header-container">
            <NavLink to="/hello">
              <Button>返回</Button>
            </NavLink>
          </div>
        }
        bordered
      >
        {obsidianVaultConfig?.map((vault) => (
          <List.Item
            key={vault.id}
            actions={[
              <NavLink key="workspace" to={`/workspace-manage/${vault.id}`}>
                <Button>工作区管理</Button>
              </NavLink>,
              <NavLink key={0} to={`/obsidian-plugin/${vault.id}`}>
                <Button>插件情况</Button>
              </NavLink>,
              isInstallObsidian && (
                <Button
                  key={1}
                  onClick={() => cmdAction('start', 'obsidianApp', vault.id)}
                >
                  用阅读器打开
                </Button>
              ),
            ].filter((item) => item)}
          >
            <List.Item.Meta
              title={`仓库 ${vault.name}`}
              description={vault.path}
            />
          </List.Item>
        ))}
        <List.Item
          actions={[
            !isInstallObsidian && (
              <Button
                key={0}
                type="primary"
                onClick={() => cmdAction('install', 'obsidianApp')}
                loading={cmdLoading && downloadProgress.status !== 'idle'}
              >
                下载并安装阅读器
              </Button>
            ),
            <Button
              key={1}
              onClick={() => configsAction('update', 'obsidianApp')}
            >
              {isInstallObsidian ? '重新定位阅读器' : '定位阅读器'}
            </Button>,
            isInstallObsidian && obsidianVersionInfo.needUpdate && (
              <Button
                key={2}
                type="primary"
                danger
                onClick={() => cmdAction('update', 'obsidianApp')}
                loading={cmdLoading && downloadProgress.status !== 'idle'}
              >
                更新阅读器
              </Button>
            ),
            isInstallObsidian && (
              <Button
                key={3}
                type="primary"
                onClick={() => cmdAction('start', 'obsidianApp')}
              >
                运行阅读器
              </Button>
            ),
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title={
              <Space>
                <span>阅读器主程序</span>
                {obsidianVersionInfo.installedVersion && (
                  <Badge
                    count={`v${obsidianVersionInfo.installedVersion}`}
                    style={{ backgroundColor: '#52c41a' }}
                  />
                )}
                {obsidianVersionInfo.needUpdate &&
                  obsidianVersionInfo.latestVersion && (
                    <Badge
                      count={`最新: v${obsidianVersionInfo.latestVersion}`}
                      style={{ backgroundColor: '#ff4d4f' }}
                    />
                  )}
              </Space>
            }
            description={
              <div>
                <div>{obsidianConfig?.obsidianApp?.bin}</div>
                {downloadProgress.status !== 'idle' && (
                  <div style={{ marginTop: 8 }}>
                    <Progress
                      percent={downloadProgress.percent}
                      status={
                        downloadProgress.status === 'done'
                          ? 'success'
                          : 'active'
                      }
                    />
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {downloadProgress.message}
                    </div>
                  </div>
                )}
              </div>
            }
          />
        </List.Item>
      </List>
    </div>
  );
}
