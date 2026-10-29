// Shared by the viewer and the offline geometry checks. Lengths are millimetres.
export const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi,v));
export function multiply(a,b) {
  const c=Array(16).fill(0);
  for(let col=0;col<4;col++) for(let row=0;row<4;row++) for(let k=0;k<4;k++) c[col*4+row]+=a[k*4+row]*b[col*4+k];
  return c;
}
export function rotationY(deg,p) {
  const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return [c,0,-s,0, 0,1,0,0, s,0,c,0, p[0]-c*p[0]-s*p[2],0,p[2]+s*p[0]-c*p[2],1];
}
export function manualPose(angle) {
  angle=clamp(Number(angle)||0,0,70);
  return {angle,release:angle>0?1:0,fold:angle>0?1:0,captive:0,phase:angle===0?'Carga · bloqueada':'Canaleta retirada · giro habilitado'};
}
// Accelerated visual sequence; timing is not a motor or granular-flow simulation.
export const cycleDuration=32;
export function cyclePose(t) {
  t=clamp(t,0,cycleDuration);
  let angle=0,release=1,fold=0,captive=0,phase='Retirar pasadores';
  if(t<1){release=t;captive=t;}
  else if(t<4){fold=(t-1)/3;captive=1;phase='Abatir canaleta';}
  else if(t<5){fold=1;captive=5-t;phase='Bloquear canaleta retirada';}
  else if(t<15){fold=1;angle=(t-5)*7;phase='Basculamiento 0° → 70°';}
  else if(t<16){fold=1;angle=70;phase='Descarga · pausa visual';}
  else if(t<26){fold=1;angle=(26-t)*7;phase='Retorno 70° → 0°';}
  else if(t<27){fold=1;captive=t-26;phase='Liberar cierre de canaleta';}
  else if(t<30){fold=(30-t)/3;captive=1;phase='Reponer canaleta';}
  else if(t<31){captive=31-t;phase='Cerrar canaleta';}
  else {release=32-t;phase=t===32?'Carga · bloqueada':'Insertar pasadores de tolva';}
  return {angle,release,fold,captive,phase};
}
export function instanceMatrix(instance,pose) {
  let m=instance.matrix.slice();const motion=instance.motion;
  if(motion.kind==='hopper') m=multiply(rotationY(pose.angle,motion.pivot),m);
  else if(motion.kind==='chute') {
    m=multiply(rotationY(-120*pose.fold,motion.pivot),m);
    // Captive locking pins must withdraw from the fixed ears before folding.
    if(instance.part.includes('PASADOR_CAUTIVO_M16')) m[13]-=60*pose.captive;
  } else if(motion.kind==='slide') for(let k=0;k<3;k++)m[12+k]+=motion.delta[k]*pose.release;
  return m;
}
