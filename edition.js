// この版の設定。個人用の版。
// 公開版(tools/make_public.py で作る)では public/edition.js に入れかわる(Google のクライアント ID は空、文言は一般向け)。
export const PUBLIC = false
// Google Cloud で作った「OAuth クライアント ID」(秘密ではない。ここに入れておけば各端末で入れずに済む)
export const CLIENT_ID = '1015317495163-vjr878t25upmdej6v5jgpbr46daaqghl.apps.googleusercontent.com'
// 同期の準備の案内のページ(空なら出さない)
export const SETUP_GUIDE = ''
// 裏メニュー(お試しモード。デバッグ用)を使えるか。公開版では使わない(v0.18.7)
export const DEBUG_MENU = true
export const TEXT = {
  placeExample: '例: 自宅、大和設計、〇〇病院',
  voiceHint: '声はこのスマホの中だけにしまいます。文字にするのは、ミニPCに移ってから(Whisper)。いまはキーボードのマイクで文章に入れられます。',
  devices: 'スマホと Surface ',
}
