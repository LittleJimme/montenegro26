/* Landschappen als ingebedde vectoren: scherp op elk formaat en zonder internet beschikbaar.
   De keuze per plek (bay / mountain / coast) komt uit de versleutelde reisgegevens. */
const SCENE_STYLES = {
  bay: { sky: '#e5e4cb', ink: '#214c4d', type: 'bay' },
  mountain: { sky: '#e4e8d1', ink: '#294d43', type: 'mountain' },
  coast: { sky: '#f2d7c4', ink: '#664d4b', type: 'coast' },
};
function sceneStyle(stay, index) {
  return SCENE_STYLES[stay && stay.scene] || SCENE_STYLES[['bay', 'mountain', 'coast'][index % 3]];
}
function pine(x,y,s,color){return '<g transform="translate('+x+' '+y+') scale('+s+')" fill="'+color+'"><path d="M0-85-25-30h12L-34 3h25l-8 20H17L9 3h25L13-30h12Z"/><path d="M-3 12h6v31h-6Z"/></g>'}
function house(x,y,s,w=28){return '<g transform="translate('+x+' '+y+') scale('+s+')"><path d="M0 0h'+w+'v33H0Z" fill="#dcc5a0"/><path d="M-4 0 '+w/2+'-13 '+(w+4)+' 0Z" fill="#ba7256"/><path d="M6 8h5v8H6Zm12 0h5v8h-5Z" fill="#6b7c70"/><path d="M'+(w/2-3)+' 24h6v9h-6Z" fill="#a28b6e"/></g>'}
function illustration(type,uid){
  const style=SCENE_STYLES[type]||SCENE_STYLES.bay;
  const p=uid.replace(/[^a-z0-9-]/gi,'');
  let s='<svg viewBox="0 0 600 1000" class="scene-svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky-'+p+'" x2="0" y2="1"><stop stop-color="'+style.sky+'"/><stop offset="1" stop-color="'+(type==='coast'?'#ecc4a8':'#ced7ba')+'"/></linearGradient><linearGradient id="water-'+p+'" x2="0" y2="1"><stop stop-color="'+(type==='coast'?'#90b7ad':'#86afa5')+'"/><stop offset="1" stop-color="#285d60"/></linearGradient><linearGradient id="land-'+p+'" x2="0" y2="1"><stop stop-color="#547966"/><stop offset="1" stop-color="#254e47"/></linearGradient></defs><path fill="url(#sky-'+p+')" d="M0 0h600v1000H0Z"/>';
  s+='<g class="cloud cloud-a" fill="#fff9e4" opacity=".36"><path d="M-15 143q23-23 46-8 20-33 52-13 29-10 40 16l48 8Z"/><path d="M443 100q18-15 30-4 15-22 40-4 15-5 24 9Z"/></g><g class="cloud cloud-b" fill="#fff9e4" opacity=".3"><path d="M368 286q18-22 40-10 15-30 37-15 26-13 41 15l45 11Z"/></g>';
  if(type==='mountain'){
    s+='<g class="sun-wrap"><circle class="sun" cx="438" cy="321" r="49" fill="#e3bc80"/><circle class="sun-halo" cx="438" cy="321" r="65" fill="#e3bc80" opacity=".12"/></g>';
    s+='<path d="M-60 632 103 326 209 499 312 324 454 561 572 345 691 602v398H-60Z" fill="#a5b5a0"/>';
    s+='<path d="M-50 743 128 525 224 398 333 558 373 430 522 636 631 558v442H-50Z" fill="#7e9886"/>';
    s+='<path d="m162 497 62-99 64 93-28-8-16 23-18-30-24 20-14-12Z" fill="#e2e4cd"/><path d="m346 482 27-52 48 68-27-9-17 7-10-22Z" fill="#d2d8bd"/>';
    s+='<path d="M-63 748 175 494 291 647 375 538 653 809v220H-63Z" fill="#5f806d"/><path d="m141 531 34-37 58 78-43-14-14-23-9 14Z" fill="#a6b59c"/>';
    s+='<path d="M0 766q92-70 189-29 90-36 220 18t191-10v255H0Z" fill="#365e54"/><path d="M116 809q137-109 278-49t90 105q-57 42-137 33t-186-8q-88-8-45-81Z" fill="#84b0a0"/><path d="M184 808q96-38 192-14m-176 44q91-24 183-2m-127 25h65" fill="none" stroke="#c4d8b8" stroke-width="2" opacity=".5" class="water-lines"/>';
    s+='<path d="M-50 1005V786q130-89 216-8 62 42 104 127 46 63 198 95Z" fill="url(#land-'+p+')"/><path d="M607 986V728q-76 19-103 74-70 66-106 193Z" fill="#3c6351"/>';
    [[38,754,1.5],[84,802,1.2],[36,865,2],[541,748,1.3],[578,854,2],[501,857,.9],[326,719,.35],[344,724,.28],[353,721,.4]].forEach(a=>s+=pine(...a,'#2d5147'));
    s+='<g class="birds" fill="none" stroke="#466358" stroke-width="1.7"><path d="M243 339q8-8 16 0 8-9 16-1m24-22q5-6 12 0 6-7 12-1"/></g>';
  }else if(type==='bay'){
    s+='<g class="sun-wrap"><circle class="sun" cx="433" cy="325" r="52" fill="#dca46f"/><circle class="sun-halo" cx="433" cy="325" r="72" fill="#dca46f" opacity=".12"/></g>';
    s+='<path d="M-55 600 55 362 130 466 230 373 317 537 414 416 655 637V1000H-55Z" fill="#b0bea3"/>';
    s+='<path d="M-10 660 105 435 160 518 221 448 298 586 342 534 516 709Z" fill="#86a08b"/>';
    s+='<path d="M-40 697 96 504 154 579 214 504 274 622 352 646 413 716Z" fill="#678b7a"/>';
    s+='<path d="M395 678 472 503 526 566 620 416v465H365Z" fill="#849b80"/><path d="M444 717 527 572 595 617 670 493v357H411Z" fill="#4d776b"/>';
    s+='<g transform="translate(0 -80)"><path d="M0 692q71-57 188-30l135 13q-72 35-25 61 43 19 99-2 116-50 203-27v413H0Z" fill="url(#water-'+p+')"/>';
    s+='<path d="M-10 748q87-101 160-96l163 23-76 22-14 38-167 66Z" fill="#abae87"/><path d="M-20 723q78-69 159-59l163 13-67 9-26 41-113 21Z" fill="#cab88b"/>';
    [[21,681,1.1,26],[50,674,1.15,28],[85,662,.95,23],[112,675,1,24],[145,665,.8,25],[165,679,.8,21],[201,677,.6,27],[62,706,.8,27],[94,702,.8,24],[130,698,.8,25],[167,696,.7,26]].forEach(a=>s+=house(...a));
    s+='<g transform="translate(104 642)"><path d="M0 0h14v60H0Z" fill="#e8d4ac"/><path d="m-3 0 10-18L17 0Z" fill="#ac624b"/><path d="M4 13h6v10H4Zm1 24h5v10H5Z" fill="#75816e"/><circle cx="7" cy="30" r="4" fill="#efe4c8"/></g>';
    s+='<path d="m162 649 19-27-5-20 31-26-3-18 21-19-6-15" fill="none" stroke="#c6ba8f" stroke-width="2.4"/><path d="m213 526 8-10h10v14h-18Z" fill="#c1b187"/>';
    s+='<g class="water-lines" fill="none" stroke="#b9d1b5" stroke-width="2" opacity=".45"><path d="M292 765h92m-178 34h95m76 47h142m-368 58h115m69 43h183M405 720h59"/></g>';
    s+='<g class="sailboat" transform="translate(359 755)"><ellipse cx="0" cy="12" rx="35" ry="3" fill="#c6d6bd" opacity=".35"/><path d="M-26 2h47l-9 10h-28Z" fill="#dfc197"/><path d="M-2-49v49H-29Z" fill="#f6e8c7"/><path d="M3-34 20 0H3Z" fill="#d6ba8e"/><path d="M0-53v57" stroke="#526a5a" stroke-width="2"/></g>';
    s+='<path d="M-30 1000V923q46-127 113-99l92 176Z" fill="#345c50"/><path d="M615 1000V890q-48-74-85-27l-98 137Z" fill="#2e5951"/>';
    s+='<g fill="#598068" transform="translate(14 919)"><path d="M0 80 10-67l17 134Zm16-42L52-49 35 53Zm6 15L87-18 48 72ZM-4 18-29-45-20 76Z"/></g>';
    s+='</g><g class="birds" fill="none" stroke="#617963" stroke-width="1.7"><path d="M306 420q8-8 16 0 8-9 16-1m17-23q5-5 11 0 6-6 12 0"/></g>';
  }else{
    s+='<g class="sun-wrap"><circle class="sun" cx="407" cy="386" r="75" fill="#edbd80"/><circle class="sun-halo" cx="407" cy="386" r="96" fill="#edbd80" opacity=".14"/></g>';
    s+='<path d="M-20 626 69 488 113 528 187 451 270 559 355 509 505 630Z" fill="#b8a296"/><path d="M-25 654 39 566 93 608 158 549 242 613 341 565 423 665Z" fill="#9b9284"/>';
    s+='<g transform="translate(0 -85)"><path d="M0 641q93-21 166 7t147-8q162-12 287 15v470H0Z" fill="url(#water-'+p+')"/>';
    s+='<path d="M-40 700q99-94 204-44l66 15-62 28Z" fill="#728c79"/><path d="M-20 705q145 89 256 58t364-58v420H-20Z" fill="#e3c89c"/><path d="M-20 696q147 77 253 49t367-52" fill="none" stroke="#f4e3bd" stroke-width="12"/>';
    s+='<g class="water-lines" fill="none" stroke="#d7debc" stroke-width="3" opacity=".65"><path d="M187 682q126 27 238-3m-187 39q154-8 280-29M44 673h70m279 58 141-25"/></g>';
    s+='<g class="wave-rings" fill="none" stroke="#f1e2bc" stroke-width="3"><ellipse cx="400" cy="684" rx="33" ry="8"/><ellipse cx="400" cy="684" rx="54" ry="13"/><ellipse cx="400" cy="684" rx="76" ry="18"/></g>';
    s+='<path d="M383 667h46l-11 7h-25Z" fill="#d1b38c"/><path d="M405 631v34h-21Z" fill="#f2e4c1"/>';
    s+='<g transform="translate(112 796) rotate(-8)"><path d="M0-39v72" stroke="#8a8163" stroke-width="4"/><path d="M-47-30q44-57 92 0Z" fill="#d19764"/><path d="M0-72q-8 15-11 42h24Q9-57 0-72" fill="#e6bf88"/><path d="m-33 16 35 10-5 23-34-10Z" fill="#f4e2b6"/><path d="m11 34 30 13-5 22-30-12Z" fill="#d5a06a"/></g>';
    s+='<g transform="translate(294 853) scale(.62)"><path d="M0-39v72" stroke="#8a8163" stroke-width="4"/><path d="M-47-30q44-57 92 0Z" fill="#b36c57"/><path d="M0-72q-8 15-11 42h24Q9-57 0-72" fill="#e7b88b"/></g>';
    s+='<path d="M490 1020q77-163 34-275" fill="none" stroke="#5e7760" stroke-width="13"/><g class="palm" fill="#4d775e"><path d="M526 759q-81-113-160-56 98 2 158 61Z"/><path d="M525 760q-119-58-134 34 72-49 134-26Z"/><path d="M526 759q6-130 91-121-48 52-82 124Z"/><path d="M526 766q51-83 118-25-62-3-106 33Z"/><path d="M526 767q50-24 78 62-54-44-78-50Z"/></g>';
    s+='</g><g class="birds" fill="none" stroke="#916e61" stroke-width="1.8"><path d="M182 376q8-8 16 0 8-9 16-1m24 28q5-6 12 0 6-7 12-1"/></g>';
  }
  const SP={mountain:[[180,830],[250,812],[330,846],[400,826],[290,870]],bay:[[330,700],[420,735],[500,690],[380,790],[540,760],[300,820]],coast:[[200,640],[260,610],[430,585],[520,600],[340,640]]};
  s+='<g class="sparkles" fill="#fff8dc">'+(SP[type]||[]).map((q,i)=>'<circle cx="'+q[0]+'" cy="'+q[1]+'" r="2.6" style="--i:'+i+'"/>').join('')+'</g>';
  s+='<g class="flock" fill="none" stroke="'+style.ink+'" stroke-width="1.6" opacity=".5"><path d="M0 0q7-7 14 0 7-8 14-1m10-16q5-5 10 0 5-6 10-1m-52 30q5-5 10 0 5-6 10-1"/></g>';
  s+='</svg>';return s;
}
