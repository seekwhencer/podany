import WebSocket from 'ws';
const BRIDGE='ws://localhost:9222/devtools/browser/4a035dde-c1a1-4de8-9086-8facd361d7f4';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
    const cdp=new WebSocket(BRIDGE);
    const log=[]; let id=0; const pending=new Map();
    cdp.on('message',(data)=>{
        const m=JSON.parse(data.toString());
        if(m.id&&pending.has(m.id)){const r=pending.get(m.id);pending.delete(m.id);r(m);}
        if(m.method) log.push('EVT '+m.method+' :: '+JSON.stringify(m.params).slice(0,250));
    });
    const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,(msg)=>msg.method&&msg.error?rej(msg.error):res(msg));cdp.send(JSON.stringify({id:i,method:m,params:p}));});
    await new Promise(r=>cdp.on('open',r));
    await send('Target.setAutoAttach',{autoAttach:true,flatten:true,failIfDetached:false});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    await send('Target.attachToTarget',{targetId,flatten:true,failIfDetached:false});
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Console.enable');
    await send('Network.enable');
    await send('Page.navigate',{url:'http://localhost:8788/dev.html'});
    await wait(9000);
    try{
        const r=await send('Runtime.evaluate',{expression:`(function(){var s=window.PodanyAppState;return JSON.stringify({hasAudio:!!document.getElementById('audio-engine'),all:app?app.state.allEpisodes.length:'noapp',cur:app?app.state.currentEpisode&&app.state.currentEpisode.id:null,status:app?app.state.playbackStatus:null,eng:app?app.state.activeEngine:null,feeds:app?app.state.feeds.length:null})})()`,returnByValue:true});
        log.push('STATE '+r.result.value);
    }catch(e){log.push('EVALERR '+JSON.stringify(e));}
    for(const x of log) console.log(x);
    cdp.close(); process.exit(0);
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
