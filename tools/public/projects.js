// ほかのアプリとのつながり。公開版では使わない(何もしない)。
export const ENABLED = false
export const PICK_LABEL = ''
export const STATS_NOTE = ''
export const load = async () => {}
export const data = () => null
export const projectText = (pj) => (pj && pj.title ? `🏷️ ${pj.title}${pj.step ? ` ・ ${pj.step}` : ''}` : '')
export const projectPicker = () => null
export const namesCard = () => null
export const otherFileMessage = () => ''
export const syncPull = async () => ({ got: 0, note: '' })
