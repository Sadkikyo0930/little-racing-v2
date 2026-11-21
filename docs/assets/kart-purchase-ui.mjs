let pendingDialog;

export async function confirmRiggedPurchase(spec) {
  if (pendingDialog) return false;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby','rigged-purchase-title');
  dialog.style.cssText = 'max-width:calc(100vw - 32px);border:1px solid #aac5ea;border-radius:16px;padding:20px;background:#132443;color:white;font:16px system-ui;';
  dialog.innerHTML = '<form method="dialog"><h2 id="rigged-purchase-title">确认购买</h2><p></p>' +
    '<div style="display:flex;gap:12px"><button value="cancel" autofocus>取消</button>' +
    '<button value="confirm">确认购买</button></div></form>';
  dialog.querySelector('p').textContent = `用 ${spec.unlock.price.toLocaleString('zh-CN')} 金币购买${spec.name}？`;
  for (const button of dialog.querySelectorAll('button')) {
    button.style.cssText = 'min-height:44px;padding:8px 15px;border-radius:8px;';
  }
  pendingDialog = dialog;
  document.body.append(dialog);
  try {
    dialog.showModal();
    return await new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once:true});
    });
  } finally {
    dialog.remove();
    pendingDialog = null;
  }
}
