import { useRegisterSW } from 'virtual:pwa-register/react'
import { T } from '../i18n'

export default function UpdateToast() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null
  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }
  return (
    <aside className="update-toast" role="status">
      <strong>{T(needRefresh ? 'Update ready' : 'Offline shell ready')}</strong>
      <span>{T(needRefresh ? 'Reload when you are ready for the latest version.' : 'Prepared songs can keep working after tracking assets are cached.')}</span>
      <div>
        {needRefresh && <button className="btn primary" onClick={() => void updateServiceWorker(true)}>{T('Reload')}</button>}
        <button className="btn subtle" onClick={close}>{T('Not now')}</button>
      </div>
    </aside>
  )
}
