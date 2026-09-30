/** Offline test build only: fewer bcrypt rounds so the demo class is created quickly in the browser. */
import bcrypt from 'bcryptjs';
export default { hash: (pw: string, _rounds: number) => bcrypt.hash(pw, 6), compare: (pw: string, h: string) => bcrypt.compare(pw, h) };
