import WebSocket from 'ws';
const BRIDGE='ws://localhost:9222/devtools/browser/4a035dde-c1a1-4de8-9086-8facd361d7f4';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=[];
function L(x){log.push(x);console.log(x);}

async function login(){
    const lr=await fetch('http://localhost:8788/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@podany.local',password:'change-me'})});
    return (await lr.json()).sessionToken;
}

async function connect(){
    return new Promise((res,rej)=>{
        const cdp=new WebSocket(BRIDGE);
        cdp.on('open',()=>res(cdp));
        cdp.on('error',(e)=>rej(e));
        setTimeout(()=>rej(new Error('open-timeout')),5000);
    });
}

async function main(){
    const token=await login();
    L('LOGIN ok token='+String(token).slice(0,10));
    let cdp;
    for(let attempt=0;attempt<3;attempt++){
        try{
            cdp=await connect();
            break;
        }catch(e){ L('connect attempt '+(attempt+1)+' failed: '+e.message); await wait(1000); }
    }
    if(!cdp){ L('NO CONNECTION'); process.exit(1); }

    let id=0; const pending=new Map();
    cdp.on('message',(data)=>{
        const m=JSON.parse(data.toString());
        if(m.id&&pending.has(m.id)){const r=pending.get(m.id);pending.delete(m.id);r(m);}
        if(m.method==='Runtime.exceptionThrown')L('EXC :: '+JSON.stringify(m.params.exceptionDetails).slice(0,250));
        if(m.method==='Console.consoleMessage')L('CONSOLE['+m.message.level+'] :: '+m.message.text.slice(0,200));
        if(m.method==='Network.responseFailed')L('NETFAIL :: '+JSON.stringify(m.params).slice(0,200));
    });
    cdp.on('error',(e)=>L('cdp-error '+e.message));
    cdp.on('close',()=>L('cdp-closed'));

    const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,(msg)=>{if(msg.method&&msg.error)rej(msg.error);else res(msg);});cdp.send(JSON.stringify({id:i,method:m,params:p}));});

    const val=async(expr)=>{
        const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
        const rr=r.result;
        return (rr&&rr.result&&rr.result.value)!==undefined?rr.result.value:(rr&&rr.value)?rr.value:JSON.stringify(r);
    };

    try{
        await send('Target.setAutoAttach',{autoAttach:true,flatten:true,failIfDetached:false});
        const {targetId}=await send('Target.createTarget',{url:'http://localhost:8788/dev.html?session='+encodeURIComponent(token)});
        L('created target '+targetId);
        await send('Target.attachToTarget',{targetId,flatten:true,failIfDetached:false});
        L('attached');
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Console.enable');
        await send('Network.enable');
        await send('Page.navigate',{url:'http://localhost:8788/dev.html?session='+encodeURIComponent(token)});
        L('navigated');

        let all=-1;
        for(let i=0;i<40;i++){
            await wait(500);
            try{ all=parseInt(await val(`app&&app.state?app.state.allEpisodes.length:-1`),10); }catch(e){all=-2;}
            if(all>0)break;
        }
        L('BOOT allEpisodes='+all);
        const st=await val(`(function(){try{return JSON.stringify({status:app.state.playbackStatus,eng:app.state.activeEngine,cur:app.state.currentEpisode&&app.state.currentEpisode.id,audio:!!document.getElementById('audio-engine'),lp:app.state.livePlayback})}catch(e){return 'ERR:'+e.message}})()`);
        L('STATE '+st);

        if(all>0){
            await wait(400);
            const cr=await val(`(function(){try{var c=document.querySelector('.episode-card');if(!c)return 'no-card';var b=c.querySelector('button');if(!b)return 'no-btn';b.click();return 'clicked:'+b.className;}catch(e){return 'ERR:'+e.message}})()`);
            L('CLICK '+cr);
            for(let i=0;i<20;i++){
                await wait(500);
                try{
                    const p=await val(`(function(){try{var a=document.getElementById('audio-engine');return JSON.stringify({paused:a?a.paused:'noaudio',src:a?a.src:'',status:app?app.state.playbackStatus:null,eng:app?app.state.activeEngine:null,lp:app?app.state.livePlayback:null})}catch(e){return 'ERR:'+e.message}})()`);
                    L('PROBE '+p);
                    try{const o=JSON.parse(p);if(o.paused===false&&o.status==='playing')break;}catch(e){}
                }catch(e){}
            }
        }
    }catch(e){ L('MAIN-ERR '+JSON.stringify(e)); }
    await wait(500);
    cdp.close(); process.exit(0);
}
main().catch(e=>{L('FATAL '+e.message);process.exit(1);});
