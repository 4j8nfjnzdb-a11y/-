// Test material drawn in the browser: a landscape, a face and a 2.6 s video.
// Nothing is bundled; every test run makes its own.
async function fixtures(browser) {
  const p = await browser.newPage();
  await p.goto('about:blank');
  const toB64 = `async (c)=>{const b=await c.convertToBlob({type:'image/png'});const u=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}`;
  const land = await p.evaluate(`(async()=>{const W=1600,H=1200,c=new OffscreenCanvas(W,H),g=c.getContext('2d');
    let gr=g.createLinearGradient(0,0,0,H*.62);gr.addColorStop(0,'#1d3f8f');gr.addColorStop(1,'#f2a25c');g.fillStyle=gr;g.fillRect(0,0,W,H);
    g.fillStyle='#fff3c4';g.beginPath();g.arc(W*.68,H*.36,120,0,7);g.fill();
    const ridge=(y,a,col,f)=>{g.fillStyle=col;g.beginPath();g.moveTo(0,H);for(let x=0;x<=W;x+=8)g.lineTo(x,y+Math.sin(x*f)*a+Math.sin(x*f*3.1+1)*a*.35);g.lineTo(W,H);g.fill()};
    ridge(H*.5,70,'#5b4a6e',.004);ridge(H*.58,55,'#3a3350',.007);ridge(H*.66,40,'#1f2a33',.011);
    g.fillStyle='#24486a';g.fillRect(0,H*.78,W,H*.22);
    for(let i=0;i<4000;i++){g.fillStyle='rgba(255,255,255,'+Math.random()*.25+')';g.fillRect(Math.random()*W,H*.78+Math.random()*H*.22,6+Math.random()*30,1.5)}
    return (${toB64})(c)})()`);
  const face = await p.evaluate(`(async()=>{const W=1080,H=1350,c=new OffscreenCanvas(W,H),g=c.getContext('2d');
    g.fillStyle='#0f3b3a';g.fillRect(0,0,W,H);
    for(let y=0;y<H;y+=40){g.fillStyle=(y/40)%2?'#145250':'#0f3b3a';g.fillRect(0,y,W,20)}
    let gr=g.createRadialGradient(W*.45,H*.38,40,W*.5,H*.42,380);gr.addColorStop(0,'#ffd9b8');gr.addColorStop(1,'#a8573a');
    g.fillStyle=gr;g.beginPath();g.ellipse(W*.5,H*.42,300,380,0,0,7);g.fill();
    g.fillStyle='#1a0f0c';for(const x of[.38,.62]){g.beginPath();g.ellipse(W*x,H*.38,46,26,0,0,7);g.fill()}
    g.strokeStyle='#5c1d16';g.lineWidth=18;g.beginPath();g.arc(W*.5,H*.5,110,.2,2.9);g.stroke();
    for(let i=0;i<14;i++){g.fillStyle=i%2?'#e8e1cf':'#c2361f';g.fillRect(i*W/14,H*.8,W/14,H*.2)}
    g.fillStyle='#fff';g.font='bold 90px sans-serif';g.fillText('KISHIMI',60,H-60);
    return (${toB64})(c)})()`);
  const vid = await p.evaluate(`(async()=>{const W=640,H=360,c=document.createElement('canvas');c.width=W;c.height=H;document.body.append(c);const g=c.getContext('2d');
    const st=c.captureStream(30),r=new MediaRecorder(st,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:4e6}),ch=[];r.ondataavailable=e=>e.data.size&&ch.push(e.data);
    let t0=performance.now(),run=true;const draw=()=>{const t=(performance.now()-t0)/1000;g.fillStyle='#101418';g.fillRect(0,0,W,H);
      for(let i=0;i<6;i++){g.fillStyle='hsl('+(i*60+t*90)+',80%,55%)';g.beginPath();g.arc(W*(.15+.14*i)+Math.sin(t*3+i)*60,H*.5+Math.cos(t*2+i)*110,38,0,7);g.fill()}
      g.save();g.translate(W/2,H/2);g.rotate(t*2);g.fillStyle='#fff';g.fillRect(-200,-6,400,12);g.restore();if(run)requestAnimationFrame(draw)};draw();
    r.start(100);await new Promise(ok=>setTimeout(ok,2600));run=false;await new Promise(ok=>{r.onstop=ok;r.stop()});
    const u=new Uint8Array(await new Blob(ch).arrayBuffer());let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)})()`);
  await p.close();
  return {
    land: { name: 'land.png', mimeType: 'image/png', buffer: Buffer.from(land, 'base64') },
    face: { name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(face, 'base64') },
    vid: { name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') },
  };
}

module.exports = { fixtures };
