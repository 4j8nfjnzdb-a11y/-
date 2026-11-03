// ---------------------------------------------------------------------------
// Mebuki DSP. Self-contained (no outer references) so it can be stringified
// into an AudioWorklet; the same Engine runs in a ScriptProcessor fallback
// and in Node for tests.
//
// Signal flow per sample:
//   track A grains -> A chain (filter, drive, crush, wow) -> level/pan --+
//   track B grains -> B chain ...........................................+-> morph
//   morph: grain share | blend | spectral | cross | ring  (+ smear, shift, freeze, all in one STFT)
//   -> master chain (filter, drive, crush) + delay return + reverb return
//   -> width -> level -> limiter
// ---------------------------------------------------------------------------
function MEBUKI_DSP(){
  const TAU=Math.PI*2;
  const clamp=(x,a,b)=>x<a?a:(x>b?b:x);
  const wrap01=x=>x-Math.floor(x);

  function makeFFT(n){
    const lev=Math.round(Math.log2(n)),rev=new Uint32Array(n),cs=new Float64Array(n/2),sn=new Float64Array(n/2);
    for(let i=0;i<n;i++){let r=0,x=i;for(let b=0;b<lev;b++){r=(r<<1)|(x&1);x>>=1}rev[i]=r}
    for(let i=0;i<n/2;i++){cs[i]=Math.cos(TAU*i/n);sn[i]=Math.sin(TAU*i/n)}
    return function(re,im,inv){
      for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
      for(let size=2;size<=n;size<<=1){
        const half=size>>1,step=n/size;
        for(let i=0;i<n;i+=size){
          for(let j=0,k=0;j<half;j++,k+=step){
            const c=cs[k],s=inv?sn[k]:-sn[k],a=i+j,b=a+half;
            const tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;
            re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
          }
        }
      }
      if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
    };
  }

  // ---------- one effect chain: filter, drive, crush, wow ----------
  class Chain{
    constructor(sr){
      this.sr=sr;this.ic1=[0,0];this.ic2=[0,0];this.hold=[0,0];this.hc=0;
      this.dl=[new Float32Array(4096),new Float32Array(4096)];this.dw=0;this.wph=0;this.fph=0;this.wr=0;this.wt=0;
      this.a1=1;this.a2=0;this.a3=0;this.k=2;this.mode=0;this.dg=1;this.dn=1;this.q=32768;this.dec=1;
      this.out=[0,0];
    }
    // per block: turn fader values into coefficients
    prep(tone,res,drive,crush){
      const sr=this.sr;
      this.mode=Math.abs(tone)<0.02?0:(tone<0?1:2);
      let fc=tone<0?20000*Math.pow(2,tone*7.4):20*Math.pow(2,tone*8.2);
      fc=clamp(fc,20,sr*0.45);
      const g=Math.tan(Math.PI*fc/sr);this.k=2-2*clamp(res,0,1)*0.96;
      this.a1=1/(1+g*(g+this.k));this.a2=g*this.a1;this.a3=g*this.a2;
      this.drive=drive;this.dg=1+drive*12;this.dn=1/Math.pow(this.dg,0.6);
      this.crush=crush;const bits=16-crush*13;this.q=Math.pow(2,bits-1);this.dec=1+Math.floor(crush*crush*30);
    }
    run(l,r,wow){
      const x=[l,r];
      // filter (TPT state variable)
      if(this.mode){
        for(let c=0;c<2;c++){
          const v3=x[c]-this.ic2[c],v1=this.a1*this.ic1[c]+this.a2*v3,v2=this.ic2[c]+this.a2*this.ic1[c]+this.a3*v3;
          this.ic1[c]=2*v1-this.ic1[c];this.ic2[c]=2*v2-this.ic2[c];
          x[c]=this.mode===1?v2:x[c]-this.k*v1-v2;
        }
      }
      if(this.drive>0.005){x[0]=Math.tanh(x[0]*this.dg)*this.dn;x[1]=Math.tanh(x[1]*this.dg)*this.dn}
      if(this.crush>0.005){
        if(++this.hc>=this.dec){this.hc=0;this.hold[0]=Math.round(x[0]*this.q)/this.q;this.hold[1]=Math.round(x[1]*this.q)/this.q}
        x[0]=this.hold[0];x[1]=this.hold[1];
      }
      // wow & flutter: a short modulated delay (constant 3 ms base so toggling never clicks)
      const sr=this.sr;
      this.wph=wrap01(this.wph+0.55/sr);this.fph=wrap01(this.fph+6.3/sr);
      if(Math.random()<1/(sr*0.4))this.wt=Math.random()*2-1;
      this.wr+=(this.wt-this.wr)*0.00004;
      const dm=sr*0.003+wow*sr*(0.0045*(0.6*Math.sin(TAU*this.wph)+0.4*this.wr)+0.0006*Math.sin(TAU*this.fph));
      const N=4096,w=this.dw;
      for(let c=0;c<2;c++){
        this.dl[c][w]=x[c];
        const rp=w-dm,i0=Math.floor(rp),f=rp-i0,a=this.dl[c][(i0+N)&(N-1)],b=this.dl[c][(i0+1+N)&(N-1)];
        x[c]=a+(b-a)*f;
      }
      this.dw=(w+1)&(N-1);
      this.out[0]=x[0];this.out[1]=x[1];
    }
  }

  // ---------- granular track ----------
  const V=32;
  class Track{
    constructor(sr){
      this.sr=sr;this.buf=null;this.timer=0;this.scan=0;
      this.act=new Uint8Array(V);this.pos=new Float64Array(V);this.inc=new Float64Array(V);this.age=new Float64Array(V);
      this.dur=new Float64Array(V);this.gl=new Float64Array(V);this.gr=new Float64Array(V);this.shp=new Float64Array(V);
      this.chain=new Chain(sr);this.peak=0;this.o=[0,0];this.lv=0;
    }
    spawn(P,dens){
      const b=this.buf;if(!b||b.frames<64)return;
      let s=-1;for(let i=0;i<V;i++)if(!this.act[i]){s=i;break}
      if(s<0)return;
      const n=b.frames;
      this.pos[s]=wrap01(P.position+this.scan+P.spray*(Math.random()*2-1)*0.5)*n;
      let semi=P.pitch+P.pspray*(Math.random()*2-1);
      if(P.toy>0.5){const oct=Math.floor(semi/12),d=semi-oct*12;let q=0;if(d>=1)q=2;if(d>=3)q=4;if(d>=5.5)q=7;if(d>=8)q=9;if(d>=10.5)q=12;semi=oct*12+q}
      let inc=Math.pow(2,semi/12)*(b.rate||1);if(Math.random()<P.rev)inc=-inc;
      this.inc[s]=inc;this.age[s]=0;
      this.dur[s]=Math.max(64,P.size*0.001*this.sr*(0.75+0.5*Math.random()));
      const pan=clamp(0.5+P.width*(Math.random()*2-1)*0.5,0,1);
      this.gl[s]=Math.cos(pan*Math.PI/2)*Math.SQRT2;this.gr[s]=Math.sin(pan*Math.PI/2)*Math.SQRT2;
      this.shp[s]=P.shape;this.act[s]=1;
    }
    tick(P,share){
      const b=this.buf;let L=0,R=0;
      if(b&&b.frames>=64){
        const n=b.frames,d0=b.data[0],d1=b.data[1]||b.data[0];
        this.scan=wrap01(this.scan+P.scan/n);
        const dens=P.density*share;
        if(--this.timer<=0){
          if(dens<0.02)this.timer=this.sr*0.02;
          else{this.timer=this.sr/dens*(0.5+Math.random());this.spawn(P,dens)}
        }
        for(let i=0;i<V;i++){
          if(!this.act[i])continue;
          let p=this.pos[i]%n;if(p<0)p+=n;
          const i0=Math.floor(p),f=p-i0,i1=i0+1<n?i0+1:0;
          const x=this.age[i]/this.dur[i],sh=this.shp[i];
          let e=0.5-0.5*Math.cos(TAU*x);
          if(sh>0.001){const pe=Math.min(1,x*40)*Math.pow(1-x,3);e=e+(pe-e)*sh}
          L+=(d0[i0]+(d0[i1]-d0[i0])*f)*e*this.gl[i];
          R+=(d1[i0]+(d1[i1]-d1[i0])*f)*e*this.gr[i];
          this.pos[i]+=this.inc[i];
          if(++this.age[i]>=this.dur[i])this.act[i]=0;
        }
        const ov=clamp(P.density*P.size*0.001,1,V);
        const g=1/Math.sqrt(ov);L*=g;R*=g;
      }
      this.chain.run(L,R,P.wow);
      L=this.chain.out[0];R=this.chain.out[1];
      // level, pan (balance), mute
      this.lv+=(P.gain-this.lv)*0.002;
      const pl=P.pan<0?1:1-P.pan,pr=P.pan>0?1:1+P.pan;
      this.o[0]=L*this.lv*pl;this.o[1]=R*this.lv*pr;
      const pk=Math.max(Math.abs(this.o[0]),Math.abs(this.o[1]));
      this.peak=pk>this.peak?pk:this.peak*0.9995;
    }
    grains(){const n=this.buf?this.buf.frames:1,a=[];for(let i=0;i<V;i++)if(this.act[i]){let p=(this.pos[i]%n)/n;if(p<0)p+=1;a.push(+p.toFixed(4),+(this.age[i]/this.dur[i]).toFixed(2))}return a}
  }

  // ---------- STFT morph: spectral / cross / smear / shift / freeze ----------
  class Spectral{
    constructor(){
      const N=1024;this.N=N;this.H=256;this.fft=makeFFT(N);
      this.win=new Float64Array(N);for(let i=0;i<N;i++)this.win[i]=0.5-0.5*Math.cos(TAU*i/N);
      const F=()=>[new Float64Array(N),new Float64Array(N)];
      this.ia=F();this.ib=F();this.ob=F();this.w=0;this.h=0;
      this.ar=new Float64Array(N);this.ai=new Float64Array(N);this.br=new Float64Array(N);this.bi=new Float64Array(N);
      this.yr=new Float64Array(N);this.yi=new Float64Array(N);
      const K=N/2+1;this.ma=new Float64Array(K);this.mb=new Float64Array(K);this.ea=new Float64Array(K);this.eb=new Float64Array(K);
      this.sm=[new Float64Array(K),new Float64Array(K)];this.fz=[new Float64Array(K),new Float64Array(K)];this.fp=[new Float64Array(K),new Float64Array(K)];
      this.last=[new Float64Array(K),new Float64Array(K)];this.lph=[new Float64Array(K),new Float64Array(K)];
      this.fzOn=[false,false];this.wasPlain=[true,true];this.o=[0,0];
    }
    envelope(mag,env){
      const K=mag.length,W=6;let s=0;
      for(let k=0;k<=W&&k<K;k++)s+=mag[k];
      for(let k=0;k<K;k++){
        const lo=k-W-1,hi=k+W;
        if(hi<K&&k>0)s+=mag[hi];
        if(lo>=0)s-=mag[lo];
        const cnt=Math.min(K-1,k+W)-Math.max(0,k-W)+1;
        env[k]=s/cnt+1e-9;
      }
    }
    frame(c,S){
      const N=this.N,K=N/2+1,win=this.win,w=this.w,ar=this.ar,ai=this.ai,br=this.br,bi=this.bi,yr=this.yr,yi=this.yi;
      const ia=this.ia[c],ib=this.ib[c];
      const needB=S.mode===2||S.mode===3;
      for(let i=0;i<N;i++){const j=(w+i)%N;ar[i]=ia[j]*win[i];ai[i]=0;if(needB){br[i]=ib[j]*win[i];bi[i]=0}}
      this.fft(ar,ai,false);if(needB)this.fft(br,bi,false);
      // freeze switched on from the plain path: capture this frame as the held spectrum
      if(S.freeze&&!this.fzOn[c]&&this.wasPlain[c]){const fz=this.fz[c],fp=this.fp[c];for(let k=0;k<K;k++){const mr=needB?(1-S.m)*ar[k]+S.m*br[k]:ar[k],mi=needB?(1-S.m)*ai[k]+S.m*bi[k]:ai[k];fz[k]=Math.hypot(mr,mi);fp[k]=Math.atan2(mi,mr)}}
      this.fzOn[c]=S.freeze;
      const plain=!needB&&S.shift===0&&S.smear<0.001&&!S.freeze;this.wasPlain[c]=plain;
      if(plain){for(let i=0;i<N;i++){yr[i]=ar[i];yi[i]=ai[i]}}
      else{
        const m=S.m,ma=this.ma,mb=this.mb;
        for(let k=0;k<K;k++){ma[k]=Math.hypot(ar[k],ai[k]);if(needB)mb[k]=Math.hypot(br[k],bi[k])}
        if(S.mode===3){this.envelope(ma,this.ea);this.envelope(mb,this.eb)}
        yr.fill(0);yi.fill(0);
        const sm=this.sm[c],fz=this.fz[c],fp=this.fp[c],last=this.last[c],lph=this.lph[c];
        const sh=S.shift,s=S.smear;
        for(let k=0;k<K;k++){
          let mag,ph;
          if(S.mode===2){
            const a=ma[k]+1e-9,b=mb[k]+1e-9;mag=Math.exp((1-m)*Math.log(a)+m*Math.log(b));
            ph=(1-m)*a>=m*b?Math.atan2(ai[k],ar[k]):Math.atan2(bi[k],br[k]);
          }else if(S.mode===3){
            const env=Math.exp((1-m)*Math.log(this.ea[k])+m*Math.log(this.eb[k]));
            mag=mb[k]/this.eb[k]*env;ph=Math.atan2(bi[k],br[k]);
          }else{mag=ma[k];ph=Math.atan2(ai[k],ar[k])}
          const kk=k+sh;
          if(kk<1||kk>=K-1)continue;
          sm[kk]=sm[kk]*s+mag*(1-s);mag=s>0.001?sm[kk]:mag;
          if(S.freeze){
            fp[kk]+=TAU*kk*this.H/N+(Math.random()-0.5)*0.6;mag=fz[kk];ph=fp[kk];
          }else{fz[kk]=mag;fp[kk]=ph}
          yr[kk]+=mag*Math.cos(ph);yi[kk]+=mag*Math.sin(ph);
        }
        for(let k=1;k<K-1;k++){yr[N-k]=yr[k];yi[N-k]=-yi[k]}
        yi[0]=0;yi[N/2]=0;
      }
      this.fft(yr,yi,true);
      const ob=this.ob[c],sc=1/1.5;
      for(let i=0;i<N;i++)ob[(w+i)%N]+=yr[i]*win[i]*sc;
    }
    // A, B stereo in; returns morphed stereo with N samples latency
    tick(aL,aR,bL,bR,S){
      const N=this.N,w=this.w;
      this.ia[0][w]=aL;this.ia[1][w]=aR;this.ib[0][w]=bL;this.ib[1][w]=bR;
      this.w=(w+1)%N;
      this.o[0]=this.ob[0][this.w];this.o[1]=this.ob[1][this.w];
      this.ob[0][this.w]=0;this.ob[1][this.w]=0;
      if(++this.h>=this.H){this.h=0;this.frame(0,S);this.frame(1,S)}
    }
  }

  // ---------- ping-pong delay ----------
  class Delay{
    constructor(sr){this.sr=sr;this.N=1<<17;this.b=[new Float32Array(this.N),new Float32Array(this.N)];this.w=0;this.t=sr*0.4;this.lp=[0,0];this.o=[0,0]}
    tick(l,r,time,fb,damp){
      const N=this.N,sr=this.sr;this.t+=(clamp(time,0.02,Math.min(2.5,(N-4)/sr))*sr-this.t)*0.0002;
      const rp=this.w-this.t,i0=Math.floor(rp),f=rp-i0,M=N-1;
      const yl=this.b[0][(i0+N)&M]*(1-f)+this.b[0][(i0+1+N)&M]*f,yr=this.b[1][(i0+N)&M]*(1-f)+this.b[1][(i0+1+N)&M]*f;
      const cut=1-clamp(damp,0,0.98);
      this.lp[0]+=(yl-this.lp[0])*cut;this.lp[1]+=(yr-this.lp[1])*cut;
      const g=clamp(fb,0,0.97);
      this.b[0][this.w]=Math.tanh(l+this.lp[1]*g);this.b[1][this.w]=Math.tanh(r+this.lp[0]*g);
      this.w=(this.w+1)&M;this.o[0]=yl;this.o[1]=yr;
    }
  }

  // ---------- 8-line feedback delay network reverb ----------
  class Reverb{
    constructor(sr){
      this.sr=sr;this.base=[29.7,37.1,41.1,43.7,53.1,59.9,67.7,73.1];this.L=8;
      this.b=this.base.map(()=>new Float32Array(Math.ceil(sr*0.073*2.2)+8));this.w=new Int32Array(8);
      this.lp=new Float64Array(8);this.len=new Float64Array(8);this.g=new Float64Array(8);this.x=new Float64Array(8);
      this.ap=[new Float32Array(Math.ceil(sr*0.0137)),new Float32Array(Math.ceil(sr*0.0089))];this.apw=[0,0];this.o=[0,0];this.set(0.5,0.4);
    }
    set(size,damp){
      const sr=this.sr,t60=0.4+size*9;this.damp=clamp(damp,0,0.95);
      for(let i=0;i<8;i++){this.len[i]=Math.floor(this.base[i]*0.001*sr*(0.5+size*1.6));this.g[i]=Math.pow(10,-3*this.len[i]/(t60*sr))}
    }
    tick(l,r){
      // two input allpass diffusers
      let s=(l+r)*0.5,d=l-r;
      for(let k=0;k<2;k++){const a=this.ap[k],n=a.length,w=this.apw[k],y=a[w];const v=s+y*0.6;a[w]=v;s=y-v*0.6;this.apw[k]=(w+1)%n}
      const x=this.x;
      for(let i=0;i<8;i++){const buf=this.b[i],n=buf.length,rp=(this.w[i]-this.len[i]+n)%n;x[i]=buf[rp]}
      // Hadamard mix (fast, normalised)
      for(let h=1;h<8;h<<=1)for(let i=0;i<8;i+=h<<1)for(let j=i;j<i+h;j++){const a=x[j],b=x[j+h];x[j]=a+b;x[j+h]=a-b}
      const nrm=1/Math.sqrt(8);let ol=0,or=0;
      for(let i=0;i<8;i++){
        const v=x[i]*nrm;this.lp[i]+=(v-this.lp[i])*(1-this.damp);
        const inj=(i&1?s-d*0.3:s+d*0.3)*0.35;
        const buf=this.b[i],n=buf.length;buf[this.w[i]]=this.lp[i]*this.g[i]+inj;this.w[i]=(this.w[i]+1)%n;
        if(i&1)or+=x[i]*nrm;else ol+=x[i]*nrm;
      }
      this.o[0]=ol*0.5;this.o[1]=or*0.5;
    }
  }

  const TRACK_DEF={position:0.2,scan:0.03,spray:0.08,density:14,size:180,pitch:0,pspray:0,toy:0,rev:0.15,width:0.6,shape:0,
    tone:0,res:0.2,drive:0,crush:0,wow:0,dsend:0,rsend:0.15,level:0.8,pan:0,mute:0,solo:0};
  const MORPH_DEF={mode:0,amount:0.3,bloom:0.3,brate:0.15,smear:0,shift:0,freeze:0};
  const MASTER_DEF={tone:0,res:0.2,drive:0,crush:0,dtime:0.42,dfb:0.45,ddamp:0.4,dret:0.35,rsize:0.6,rdamp:0.45,rret:0.4,width:1,level:0.8};

  class Engine{
    constructor(sr){
      this.sr=sr;this.run=false;this.g=0;
      this.T=[new Track(sr),new Track(sr)];
      this.P={a:Object.assign({},TRACK_DEF),b:Object.assign({},TRACK_DEF,{position:0.5,scan:-0.02}),m:Object.assign({},MORPH_DEF),x:Object.assign({},MASTER_DEF)};
      this.spec=new Spectral();this.mc=new Chain(sr);this.dly=new Delay(sr);this.rev=new Reverb(sr);
      this.mo=this.P.m.amount;this.bw=0;this.bt=0;this.btimer=0;this.env=0;this.k=0;this.peak=[0,0];
      this.dirty=true;
    }
    handle(d){
      if(d.t==='buf'){const tr=this.T[d.track];tr.buf=d.frames?{frames:d.frames,data:d.data,rate:d.rate||1}:null;tr.act.fill(0);tr.scan=0}
      else if(d.t==='p'){const [g,k]=d.k.split('.');if(this.P[g]&&(k in this.P[g])){this.P[g][k]=d.v;this.dirty=true}}
      else if(d.t==='run')this.run=!!d.v;
    }
    prepare(){
      const P=this.P;
      for(let i=0;i<2;i++){const q=P[i?'b':'a'];this.T[i].chain.prep(q.tone,q.res,q.drive,q.crush)}
      this.mc.prep(P.x.tone,P.x.res,P.x.drive,P.x.crush);this.rev.set(P.x.rsize,P.x.rdamp);this.dirty=false;
      const solo=P.a.solo>0.5||P.b.solo>0.5;
      for(const k of ['a','b']){const q=P[k];q.gain=(q.mute>0.5||(solo&&q.solo<0.5))?0:q.level}
    }
    render(L,R,n){
      if(!this.run&&this.g<1e-4){L.fill(0);R.fill(0);this.g=0;return}
      if(this.dirty)this.prepare();
      const P=this.P,A=this.T[0],B=this.T[1],M=P.m,X=P.x,sr=this.sr;
      const mode=Math.round(M.mode),S={mode:mode===2?2:(mode===3?3:0),m:0,shift:Math.round(M.shift*40),smear:clamp(M.smear,0,0.98),freeze:M.freeze>0.5};
      const target=this.run?1:0;
      for(let i=0;i<n;i++){
        // bloom: the morph wanders on its own
        if(--this.btimer<=0){this.btimer=sr/(0.05+M.brate*3)*(0.5+Math.random());this.bt=Math.random()*2-1}
        this.bw+=(this.bt-this.bw)*(0.00002+M.brate*0.0002);
        this.mo+=(clamp(M.amount+M.bloom*this.bw*0.5,0,1)-this.mo)*0.002;
        const m=this.mo;S.m=m;
        const shA=mode===0?1-m:1,shB=mode===0?m:1;
        A.tick(P.a,shA);B.tick(P.b,shB);
        const al=A.o[0],ar=A.o[1],bl=B.o[0],br=B.o[1];
        // what reaches the spectral stage
        let xl,xr,yl=0,yr=0;
        if(mode===0){xl=al+bl;xr=ar+br}
        else if(mode===1){const ca=Math.cos(m*Math.PI/2),cb=Math.sin(m*Math.PI/2);xl=al*ca+bl*cb;xr=ar*ca+br*cb}
        else if(mode===4){xl=(al+bl)*0.7*(1-m)+al*bl*5*m;xr=(ar+br)*0.7*(1-m)+ar*br*5*m}
        else{xl=al;xr=ar;yl=bl;yr=br}
        this.spec.tick(xl,xr,yl,yr,S);
        let ml=this.spec.o[0],mr=this.spec.o[1];
        // sends, weighted by how much each track is in the morph
        const wa=mode===0||mode===4?1:1-m*(mode===1?1:0.5),wb=mode===0||mode===4?1:(mode===1?m:0.5+m*0.5);
        const sl=al*P.a.dsend*wa+bl*P.b.dsend*wb,srr=ar*P.a.dsend*wa+br*P.b.dsend*wb;
        const rl=al*P.a.rsend*wa+bl*P.b.rsend*wb,rr=ar*P.a.rsend*wa+br*P.b.rsend*wb;
        this.dly.tick(sl,srr,X.dtime,X.dfb,X.ddamp);this.rev.tick(rl,rr);
        ml+=this.dly.o[0]*X.dret+this.rev.o[0]*X.rret;mr+=this.dly.o[1]*X.dret+this.rev.o[1]*X.rret;
        this.mc.run(ml,mr,0);ml=this.mc.out[0];mr=this.mc.out[1];
        // width (mid/side), level, limiter
        const mid=(ml+mr)*0.5,side=(ml-mr)*0.5*X.width;ml=(mid+side)*X.level;mr=(mid-side)*X.level;
        const pk=Math.max(Math.abs(ml),Math.abs(mr));
        this.env=pk>this.env?this.env+(pk-this.env)*0.2:this.env*0.99985;
        const lg=this.env>0.9?0.9/this.env:1;
        this.g+=(target-this.g)*0.0015;
        ml=Math.tanh(ml*lg)*this.g;mr=Math.tanh(mr*lg)*this.g;
        if(!(ml>-2&&ml<2))ml=0;if(!(mr>-2&&mr<2))mr=0;
        L[i]=ml;R[i]=mr;
        this.peak[0]=Math.max(this.peak[0]*0.9995,Math.abs(ml));this.peak[1]=Math.max(this.peak[1]*0.9995,Math.abs(mr));
      }
    }
    status(){
      this.k++;
      return{ga:this.T[0].grains(),gb:this.T[1].grains(),sa:this.T[0].scan,sb:this.T[1].scan,m:this.mo,
        pa:this.T[0].peak,pb:this.T[1].peak,pm:Math.max(this.peak[0],this.peak[1])};
    }
  }
  return{Engine,TRACK_DEF,MORPH_DEF,MASTER_DEF,makeFFT};
}
if(typeof module!=='undefined')module.exports=MEBUKI_DSP;
