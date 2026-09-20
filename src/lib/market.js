/** Rough US equity session status in America/New_York terms. */
export function marketStatus() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const h = et.getHours() + et.getMinutes() / 60;
  const open = day >= 1 && day <= 5 && h >= 9.5 && h < 16;
  return {
    open,
    label: open ? '美股盘中 / US market open' : '休市（最近收盘） / Closed (last close)',
    shortZh: open ? '美股盘中' : '休市（最近收盘）',
    shortEn: open ? 'US market open' : 'Closed (last close)',
  };
}
