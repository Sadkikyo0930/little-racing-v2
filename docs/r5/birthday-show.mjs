export const BIRTHDAY_ID = 'birthday-star-6';

export async function openBirthdayShow(onClose) {
  let dialog;
  try {
    const base = new URL('../assets/birthday/', import.meta.url);
    const { default: template } = await import('../assets/birthday/show-template.mjs');
    dialog = document.createElement('dialog');
    dialog.style.cssText = 'inset:0;margin:0;padding:0;border:0;width:100%;height:100%;max-width:none;max-height:none;background:#101428;overflow:hidden';
    dialog.setAttribute('aria-label', '生日惊喜');
    const frame = document.createElement('iframe');
    frame.title = '生日开箱';
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    frame.allowFullscreen = true;
    frame.srcdoc = template.replace('__BIRTHDAY_ASSET_BASE__', base.href);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '返回游戏';
    close.style.cssText = 'position:absolute;z-index:2;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));padding:8px 14px;border-radius:18px;border:0;background:#faf1cc;color:#251a42;font-weight:bold';
    close.onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      dialog.remove();
      onClose();
    }, { once: true });
    dialog.append(frame, close);
    document.body.append(dialog);
    dialog.showModal();
  } catch (error) {
    dialog?.remove();
    onClose();
    console.warn('[r5] 生日开箱加载失败', error);
  }
}
