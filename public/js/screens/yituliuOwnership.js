import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from '../ui/components.js';
import { data } from '../data.js';
import { loadoutStore, applyOwnershipImport } from '../ui/loadoutSync.js';
import { previewYituliuOwnership, readYituliuOperators } from '../ui/yituliuOwnership.js';
import { toast } from '../ui/toasts.js';
import { t, N_ } from '../../../shared/i18n.js';

const ERRORS = {
  token: N_('请输入一图流生成的 32 位只读 Token'),
  auth: N_('Token 无效、已撤销或没有读取权限，请到一图流检查'),
  empty: N_('一图流没有返回干员，原设置保持不变'),
  format: N_('一图流返回的数据格式异常，原设置保持不变'),
  size: N_('一图流返回的数据过大，原设置保持不变'),
  rate: N_('一图流暂时限制请求，请稍后手动重试'),
  timeout: N_('读取超时，原设置保持不变，请稍后手动重试'),
  network: N_('无法读取一图流数据，请检查网络或浏览器跨域限制后重试'),
  service: N_('一图流服务未能提供数据，原设置保持不变'),
};

/** Dialog-scoped secret and request. Unmounting (close, back, or context change) aborts and discards both. */
export function YituliuOwnershipDialog({ onClose, onBack, ready }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [charIds, setCharIds] = useState(null);
  const [error, setError] = useState('');
  const input = useRef(null);
  const request = useRef(null);
  const confirmed = useRef(false);
  useEffect(() => () => {
    request.current?.abort(); request.current = null;
    if (input.current) input.current.value = '';
  }, []);
  const close = (next) => {
    request.current?.abort(); request.current = null;
    if (input.current) input.current.value = '';
    setToken(''); setCharIds(null); next();
  };
  const read = async () => {
    if (request.current || !ready) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setCharIds(null);
    const pending = readYituliuOperators(token, { signal: controller.signal });
    setToken(''); if (input.current) input.current.value = '';
    const result = await pending;
    if (request.current !== controller) return;
    request.current = null; setBusy(false);
    if (result.ok) setCharIds(result.charIds);
    else if (result.error !== 'cancelled') setError(ERRORS[result.error] || ERRORS.service);
  };
  const preview = charIds ? previewYituliuOwnership(charIds, data.list('chess'), loadoutStore.get().notOwned) : null;
  const apply = () => {
    if (confirmed.current || !charIds || !ready || !data.list('chess').length) return;
    // Recompute at confirmation so intervening edits to the current app state are preserved.
    const latest = previewYituliuOwnership(charIds, data.list('chess'), loadoutStore.get().notOwned);
    if (!latest.changed) return;
    confirmed.current = true;
    applyOwnershipImport(latest.notOwned, (id) => data.lookup('chess', id));
    close(onClose);
    toast(t('已补充 {n} 名干员为持有，其他设置保持不变', { n: latest.changed }), 'success');
  };
  const names = preview?.ownedChessIds.filter((id) => loadoutStore.get().notOwned.includes(id))
    .map((id) => data.lookup('chess', id)?.name).filter(Boolean).join('、');
  return html`<${Modal} open=${true} onClose=${() => close(onClose)} title=${t('从一图流补充干员持有')} micro="OPERATOR ROSTER"
    actions=${html`<${Button} variant="ghost" data-testid="yituliu-cancel" onClick=${() => close(onClose)}>${t('取消')}<//>
      <${Button} variant="secondary" data-testid="yituliu-back" onClick=${() => close(onBack)}>${t('返回文件导入')}<//>
      <${Button} variant="primary" data-testid="yituliu-apply" disabled=${busy || !ready || !preview?.changed} onClick=${apply}>${t('确认补充持有')}<//>`}>
    <p class="lo-io__hint">${t('仅补充本项目支持名单中匹配的已持有干员。未列出的干员保持原设置，仍可手动调整。')}</p>
    <p class="lo-io__hint">${t('读取的是一图流最近保存的列表，可能不完整或过时，不是游戏实时数据；不会导入练度、技能、模组或自选编队。')}</p>
    <p class="lo-io__hint"><a href="https://ark.yituliu.cn/account/home" target="_blank" rel="noopener noreferrer">${t('前往一图流获取只读 Token')} ↗</a></p>
    <label class="lo-yituliu__label" for="yituliu-token">${t('一图流只读 Token')}</label>
    <input id="yituliu-token" ref=${input} class="lo-yituliu__token" type="password" autoComplete="off" spellcheck=${false} maxLength=${64}
      data-testid="yituliu-token" data-autofocus value=${token} disabled=${busy}
      onInput=${(e) => { setToken(e.currentTarget.value); setCharIds(null); setError(''); }} />
    <p class="lo-io__hint">${t('Token 仅临时用于浏览器直接读取一图流；不保存、不上传到本项目服务器，读取或关闭后清空。请勿粘贴森空岛或鹰角登录凭据。')}</p>
    <${Button} variant="secondary" data-testid="yituliu-read" disabled=${busy || !ready} onClick=${read}>${busy ? t('正在读取…') : t('读取并预览')}<//>
    ${error ? html`<p class="lo-yituliu__result" role="alert">${t(error)}</p>` : null}
    ${preview ? html`<div class="lo-yituliu__result" data-testid="yituliu-preview" role="status">
      <p>${t('匹配 {matched} 名；将把 {changed} 名未持有干员改为持有。', { matched: preview.matched, changed: preview.changed })}</p>
      <p>${t('联动及其他当前不支持的条目均跳过（共 {n} 项），不会新增干员。', { n: preview.skipped })}</p>
      ${names ? html`<p>${t('本次调整：{names}', { names })}</p>` : html`<p>${t('没有需要补充的持有设置，原设置保持不变')}</p>`}
    </div>` : null}
  <//>`;
}
