import * as THREE from '../lib/three.module.js?v=e2b5ee6b';
import { makeInterviewee } from '../lib/avatar.js?v=3b5fc8fb';

/* 相手役を画面に出す。喋っている間だけ口が動き、時々まばたきとうなずきが入る。
   狙いは「実在感」ではなく「相手が今どういう状態か（話している／聞いている）が分かる」こと。 */

// 役ごとの見た目。同じ職種なら毎回同じ人が出るよう、役名から決める。
const LOOKS = {
  '医療ソーシャルワーカー（病院）': { outfitKind: 'coat', hairStyle: 'short' },
  '地域包括支援センターの社会福祉士': { outfitKind: 'suit', hairStyle: 'bob' },
  '相談支援専門員（障害）': { outfitKind: 'suit', hairStyle: 'short' },
  '介護支援専門員（ケアマネジャー）': { outfitKind: 'casual', hairStyle: 'tied' },
  '訪問看護師': { outfitKind: 'coat', hairStyle: 'tied' },
  '精神科病院の精神保健福祉士': { outfitKind: 'coat', hairStyle: 'short' },
  '行政（福祉課）の職員': { outfitKind: 'suit', hairStyle: 'short' },
  '保健所・市町村の保健師': { outfitKind: 'coat', hairStyle: 'bob' },
  'スクールソーシャルワーカー': { outfitKind: 'casual', hairStyle: 'bob' },
  '民生委員': { outfitKind: 'casual', hairStyle: 'short' },
  '本人': { outfitKind: 'casual', hairStyle: 'short' },
  '家族（主たる介護者）': { outfitKind: 'casual', hairStyle: 'bob' },
};

const HAIRS = [0x2b2119, 0x171310, 0x4a3a2c, 0x6b6b6b];
const SKINS = [0xf2d5bb, 0xe8c39e, 0xd9ae8a];

export function createAvatarView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  // 胸から上が枠いっぱいに入る距離。表情の変化を見せるのが目的なので寄り気味にする
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  camera.position.set(0, 0.52, 1.32);
  camera.lookAt(0, 0.45, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x93a4ad, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(1.4, 2.2, 1.8);
  scene.add(key);

  let avatar = null;
  let speaking = false;
  let raf = 0;
  // まばたきは等間隔だと機械的に見えるので、次回までの時間を毎回引き直す
  let nextBlink = 1.5 + Math.random() * 3;
  let blinkT = -1;
  let nextNod = 3 + Math.random() * 5;
  let nodT = -1;

  function setRole(role) {
    if (avatar) { scene.remove(avatar.group); avatar = null; }
    const look = LOOKS[role] || { outfitKind: 'casual', hairStyle: 'short' };
    // 役名から決めるので、同じ役なら毎回同じ髪・肌になる
    let h = 0;
    for (const ch of role || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    avatar = makeInterviewee({
      ...look,
      hair: HAIRS[h % HAIRS.length],
      skin: SKINS[(h >> 3) % SKINS.length],
    });
    scene.add(avatar.group);
  }

  function resize() {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }

  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!avatar) return;
    const p = avatar.parts;
    const t = now / 1000;

    // 呼吸。止まっていると人形に見えるので、黙っている間も少し動かす
    p.torso.rotation.x = Math.sin(t * 1.1) * 0.012;
    p.torso.position.y = Math.sin(t * 1.1) * 0.004;

    // 口。母音の判別はできないので、話している間だけ速さの違う波を重ねて開閉させる
    const open = speaking
      ? Math.max(0, 0.30 * Math.sin(t * 13) + 0.18 * Math.sin(t * 21.7 + 1.2) + 0.16)
      : 0;
    p.jaw.rotation.x += (open - p.jaw.rotation.x) * Math.min(1, dt * 22);

    // まばたき
    nextBlink -= dt;
    if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 1.8 + Math.random() * 4; }
    if (blinkT >= 0) {
      blinkT += dt;
      const k = blinkT < 0.06 ? blinkT / 0.06 : blinkT < 0.14 ? 1 - (blinkT - 0.06) / 0.08 : 0;
      const s = 1 - k * 0.92;
      p.eyeL.scale.y = s; p.eyeR.scale.y = s;
      if (blinkT > 0.16) { blinkT = -1; p.eyeL.scale.y = 1; p.eyeR.scale.y = 1; }
    }

    // 相づちのうなずき。聞いている間だけ入れる（話しながら頷くと落ち着かない）
    nextNod -= dt;
    if (!speaking && nextNod <= 0 && nodT < 0) { nodT = 0; nextNod = 4 + Math.random() * 7; }
    if (nodT >= 0) {
      nodT += dt;
      p.head.rotation.x = Math.sin(nodT * 9) * 0.11 * Math.max(0, 1 - nodT / 0.7);
      if (nodT > 0.7) { nodT = -1; p.head.rotation.x = 0; }
    } else if (!speaking) {
      p.head.rotation.x += (0 - p.head.rotation.x) * dt * 4;
    }
    // 話しているときは、わずかに顔が動くほうが自然に見える
    p.head.rotation.y = Math.sin(t * 0.7) * 0.05 + (speaking ? Math.sin(t * 2.3) * 0.03 : 0);

    resize();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  return {
    setRole,
    setSpeaking(v) { speaking = !!v; },
    getParts() { return avatar ? avatar.parts : null; },   // 動作確認用
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); },
  };
}
