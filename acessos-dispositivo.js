export function identificarDispositivo(userAgent, touchPoints = 0) {
  const ua=String(userAgent || '');
  if (!ua || /bot|crawler|spider|headless/i.test(ua)) return 'nao_identificado';
  if (/iPad|Tablet|Kindle|Silk|PlayBook/i.test(ua) || (/Macintosh/i.test(ua) && Number(touchPoints)>1) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|Mobi/i.test(ua)) return 'celular';
  if (/Windows NT|Macintosh|X11|Linux|CrOS/i.test(ua)) return 'computador';
  return 'nao_identificado';
}
