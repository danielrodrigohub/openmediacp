import { createUser,hashPassword } from '../src/server/auth.ts';
import { db,audit } from '../src/server/db.ts';
const [action='create',username]=process.argv.slice(2);
if(!username||!['create','reset'].includes(action)){console.error('Uso: node scripts/admin.mjs create|reset USUARIO (contraseña por stdin)');process.exit(1);}
let password='';for await(const chunk of process.stdin){password+=chunk;if(password.length>1024)throw new Error('Entrada demasiado larga.');}
password=password.replace(/\r?\n$/,'');
try{
 if(action==='create'){await createUser(username,password,'admin');console.log('Superadministrador creado.');}
 else{const hash=await hashPassword(password);const user=db.prepare("SELECT id FROM users WHERE username=? AND role='admin'").get(username);if(!user)throw new Error('Administrador no encontrado.');db.prepare('UPDATE users SET password=? WHERE id=?').run(hash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);audit(user.id,'admin_password_reset');console.log('Contraseña renovada; sesiones revocadas.');}
}catch(error){console.error(error.message);process.exitCode=1;}
