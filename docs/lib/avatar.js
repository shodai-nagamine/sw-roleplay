// 人物の造形。Antigravity CLI(agy, gemini-3.1-pro-high)に発注したものを検収して取り込んだ。
// 発注時の要件: Y上・+Z向き・腰が原点・関節をGroupの原点にする・MeshLambertMaterialで統一。
import * as THREE from './three.module.js?v=e2b5ee6b';

function makeInterviewee(opts = {}) {
  const group = new THREE.Group();

  const skinHex = opts.skin !== undefined ? opts.skin : 0xffe0bd;
  const hairHex = opts.hair !== undefined ? opts.hair : 0x222222;
  const k = opts.outfitKind || 'casual';
  const outfitHex = opts.outfit !== undefined ? opts.outfit : 
    (k === 'coat' ? 0xffffff : (k === 'suit' ? 0x2a2a35 : 0x3a6a5a));

  // 描画負荷軽減のためマテリアルは冒頭でまとめて定義し使い回す
  const matSkin = new THREE.MeshLambertMaterial({ color: skinHex });
  const matHair = new THREE.MeshLambertMaterial({ color: hairHex });
  const matOutfit = new THREE.MeshLambertMaterial({ color: outfitHex });
  const matOutfitSub = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  const matWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const matTie = new THREE.MeshLambertMaterial({ color: 0x334488 });
  const matEye = new THREE.MeshLambertMaterial({ color: 0x222222 });
  // 開口時に「口が開いている」と一目でわかるよう暗い赤色にする
  const matMouthSub = new THREE.MeshLambertMaterial({ color: 0x551111 });

  // ポリゴン数を抑えるため分割数は控えめにする
  const geoSphere = new THREE.SphereGeometry(1, 12, 10);
  const geoCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const geoBox = new THREE.BoxGeometry(1, 1, 1);

  const add = (geo, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    if (sx !== 1 || sy !== 1 || sz !== 1) m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // 呼吸や前傾姿勢のアニメーションを腰基点で可能にする
  const torso = new THREE.Group();
  torso.position.set(0, 0, 0);
  group.add(torso);

  // 服のベース（共通）
  add(geoCyl, matOutfit, torso, 0, 0.2, 0, 0, 0, 0, 0.18, 0.4, 0.1);
  add(geoSphere, matOutfit, torso, 0, 0.28, 0, 0, 0, 0, 0.18, 0.15, 0.11);
  // 肩の丸みを出す
  add(geoSphere, matOutfit, torso, 0, 0.36, 0, 0, 0, 0, 0.17, 0.06, 0.1);

  // 服装のバリエーションによるシルエットの差異を簡易表現
  if (k === 'suit') {
    add(geoCyl, matWhite, torso, 0, 0.32, 0.06, 0.2, 0, 0, 0.08, 0.18, 0.05);
    add(geoBox, matTie, torso, 0, 0.26, 0.11, 0.1, 0, 0, 0.03, 0.15, 0.01);
  } else if (k === 'coat') {
    add(geoCyl, matOutfitSub, torso, 0, 0.30, 0.05, 0.1, 0, 0, 0.08, 0.22, 0.06);
    add(geoCyl, matOutfit, torso, 0, 0.2, 0, 0, 0, 0, 0.2, 0.4, 0.12);
  } else {
    // casual: 首元にインナーを少し見せて立体感を出す
    add(geoSphere, matOutfitSub, torso, 0, 0.38, 0.05, 0, 0, 0, 0.08, 0.05, 0.06);
  }

  // 腕（肩を原点とし、腕振りを容易にする）
  const armL = new THREE.Group();
  armL.position.set(0.2, 0.35, 0);
  torso.add(armL);
  add(geoCyl, matOutfit, armL, 0, -0.15, 0, 0, 0, 0, 0.05, 0.35, 0.05);
  add(geoSphere, matSkin, armL, 0, -0.34, 0, 0, 0, 0, 0.04, 0.05, 0.04);

  const armR = new THREE.Group();
  armR.position.set(-0.2, 0.35, 0);
  torso.add(armR);
  add(geoCyl, matOutfit, armR, 0, -0.15, 0, 0, 0, 0, 0.05, 0.35, 0.05);
  add(geoSphere, matSkin, armR, 0, -0.34, 0, 0, 0, 0, 0.04, 0.05, 0.04);

  // 首・頭（うなずき・首振りの原点）
  const head = new THREE.Group();
  head.position.set(0, 0.4, 0);
  torso.add(head);

  add(geoCyl, matSkin, head, 0, 0.05, 0, 0, 0, 0, 0.05, 0.1, 0.05);
  
  // 頭蓋
  add(geoSphere, matSkin, head, 0, 0.22, 0.0, 0, 0, 0, 0.11, 0.11, 0.12);
  // 顔面
  add(geoSphere, matSkin, head, 0, 0.17, 0.05, 0, 0, 0, 0.1, 0.08, 0.1);
  // 鼻
  add(geoSphere, matSkin, head, 0, 0.17, 0.15, 0, 0, 0, 0.02, 0.03, 0.02);

  // 顎が開いた際に見える口腔奥の暗がり
  add(geoBox, matMouthSub, head, 0, 0.12, 0.11, 0, 0, 0, 0.06, 0.04, 0.04);

  // 耳
  add(geoSphere, matSkin, head, 0.11, 0.18, 0.02, 0, 0, 0, 0.02, 0.03, 0.02);
  add(geoSphere, matSkin, head, -0.11, 0.18, 0.02, 0, 0, 0, 0.02, 0.03, 0.02);

  // まばたき時に scale.y を変更するため、Meshを直接ラップする
  const makeEye = (x) => {
    const g = new THREE.Group();
    g.position.set(x, 0.20, 0.135);
    head.add(g);
    add(geoSphere, matEye, g, 0, 0, 0, 0, 0, 0, 0.015, 0.015, 0.015);
    return g;
  };
  const eyeL = makeEye(0.04);
  const eyeR = makeEye(-0.04);

  // 眉の上下移動用
  const makeBrow = (x, rotZ) => {
    const g = new THREE.Group();
    g.position.set(x, 0.23, 0.138);
    head.add(g);
    add(geoBox, matHair, g, 0, 0, 0, 0, 0, rotZ, 0.035, 0.005, 0.005);
    return g;
  };
  const browL = makeBrow(0.04, 0.1);
  const browR = makeBrow(-0.04, -0.1);

  // 顎（発話の口パク用。X軸正方向の回転で開くように耳下あたりを原点とする）
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.15, 0.02);
  head.add(jaw);
  
  // 下顎・下唇
  add(geoSphere, matSkin, jaw, 0, -0.04, 0.09, 0, 0, 0, 0.09, 0.04, 0.09);

  // 髪の毛（頭部へのめり込みを利用して形状を作る）
  add(geoSphere, matHair, head, 0, 0.23, 0.0, 0, 0, 0, 0.12, 0.12, 0.13);
  add(geoSphere, matHair, head, 0, 0.28, 0.09, 0.3, 0, 0, 0.1, 0.04, 0.06);

  const hs = opts.hairStyle || 'short';
  if (hs === 'bob') {
    add(geoSphere, matHair, head, 0.1, 0.15, 0.02, 0, 0, 0, 0.04, 0.1, 0.08);
    add(geoSphere, matHair, head, -0.1, 0.15, 0.02, 0, 0, 0, 0.04, 0.1, 0.08);
  } else if (hs === 'tied') {
    // 結び目とテール部分
    add(geoSphere, matHair, head, 0, 0.15, -0.13, 0, 0, 0, 0.03, 0.03, 0.04);
    add(geoSphere, matHair, head, 0, 0.05, -0.15, -0.2, 0, 0, 0.04, 0.12, 0.05);
  }

  return {
    group,
    parts: {
      head,
      jaw,
      eyeL,
      eyeR,
      browL,
      browR,
      torso,
      armL,
      armR
    }
  };
}

export { makeInterviewee };
