// The stylesheet the UI had before the design system, moved here verbatim from App.tsx and still
// rendered by the shell as <style>{LEGACY_STYLES}</style>. Temporary: the design system replaces it.

export const COLORS = {
  bg0: "#0f0f0f",
  bg1: "#212121",
  accent: "#00ffbf",
  accent2: "#8c19ff",
  text: "rgba(255,255,255,0.92)",
  textDim: "rgba(255,255,255,0.65)",
  panel: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
};

export const LEGACY_STYLES = `
        :root{
          --bg0:${COLORS.bg0};
          --bg1:${COLORS.bg1};
          --accent:${COLORS.accent};
          --accent2:${COLORS.accent2};
          --text:${COLORS.text};
          --textDim:${COLORS.textDim};
          --panel:${COLORS.panel};
          --border:${COLORS.border};
        }
        *{ box-sizing:border-box; }
        body,html,#root{ height:100%; margin:0; background:var(--bg0); color:var(--text); font-family:system-ui,-apple-system,Segoe UI,Roboto; }
        .app{
          height:100%;
          display:flex;
          flex-direction:column;
          background: radial-gradient(1200px 600px at 20% 0%, rgba(0,255,191,0.10), transparent 60%),
                      radial-gradient(900px 600px at 80% 10%, rgba(140,25,255,0.10), transparent 60%),
                      linear-gradient(180deg, rgba(255,255,255,0.02), transparent 40%),
                      var(--bg0);
        }
        .topbar{
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:16px;
        }
        .brand{
          display:flex;
          align-items:center;
          gap:12px;
          font-weight:800;
          letter-spacing:0.2px;
          font-size:22px;
        }
        .btn{
          border:1px solid var(--border);
          background: rgba(255,255,255,0.06);
          color: var(--text);
          padding: 8px 12px;
          border-radius: 12px;
          cursor:pointer;
        }
        .btn:disabled{ opacity:0.45; cursor:not-allowed; }
        .status{
          padding: 8px 12px;
          border:1px solid var(--border);
          border-radius: 14px;
          background: rgba(0,0,0,0.25);
          color: var(--textDim);
          font-size: 13px;
        }

        .downloadBar{
          display:flex;
          flex-wrap: wrap;  /* narrow windows: the buttons go to a second row, never off the side */
          align-items:center;
          gap: 10px;
          padding: 0 16px 12px 16px;
        }
        .brand .testLibraryNote{ margin-top: 0; font-weight: 400; letter-spacing: 0; white-space: nowrap; }
        .devBar{ display:flex; flex-wrap: wrap; align-items:center; gap: 8px; padding: 0 16px 12px 16px; }
        .downloadInput{
          flex: 1;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          outline:none;
        }
        .downloadInput:focus{
          border-color: rgba(0,255,191,0.45);
          box-shadow: 0 0 0 3px rgba(0,255,191,0.08);
        }
        .targetLabel{ color: var(--textDim); font-size: 13px; white-space: nowrap; }
        .targetNew{ width: 220px; flex: none; }

        /* In-app dropdown */
        .dd{ position: relative; }
        .ddBtn{
          display:flex; align-items:center; gap: 8px;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          cursor: pointer;
          max-width: 260px;
          font: inherit;
        }
        .ddBtn.open, .ddBtn:focus{
          border-color: rgba(0,255,191,0.45);
          box-shadow: 0 0 0 3px rgba(0,255,191,0.08);
          outline: none;
        }
        .ddLabel{ overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ddChevron{ color: var(--textDim); font-size: 12px; }
        .ddMenu{
          position: absolute; z-index: 50;
          top: calc(100% + 6px); left: 0;
          min-width: 100%; width: max-content; max-width: 340px;
          max-height: 340px; overflow: auto;
          padding: 6px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: #1a1a1a;
          box-shadow: 0 14px 40px rgba(0,0,0,0.65);
        }
        .ddMenu.up{ top: auto; bottom: calc(100% + 6px); }
        .player{ position: relative; z-index: 5; }  /* popups from the bar float above the panels */
        .ddItem{
          padding: 8px 10px;
          border-radius: 10px;
          cursor: pointer;
          color: var(--text);
          white-space: nowrap;
          border: 1px solid transparent;
        }
        .ddItem:hover{ background: rgba(255,255,255,0.06); }
        .ddItem.active{ border-color: rgba(0,255,191,0.35); background: rgba(0,255,191,0.10); }
        .ddExtra{ color: var(--accent); margin-top: 4px; }
        .ddSmall{ margin-top: 6px; }
        .ddSmall .ddBtn{ padding: 5px 10px; font-size: 12px; border-radius: 10px; color: var(--textDim); }

        .shuffleBtn{
          display:grid; place-items:center;
          width: 38px; height: 38px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.45);
          cursor: pointer;
          transition: color .15s, border-color .15s, background .15s, transform .1s;
        }
        .shuffleBtn:hover{ color: var(--text); background: rgba(255,255,255,0.08); }
        .shuffleBtn:active{ transform: scale(0.94); }
        .shuffleBtn.on{
          color: var(--accent);
          border-color: rgba(0,255,191,0.45);
          background: rgba(0,255,191,0.10);
          box-shadow: 0 0 0 3px rgba(0,255,191,0.08);
        }
        .iconBtn{
          display:grid; place-items:center;
          width: 40px; height: 40px; flex:none;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.04);
          color: var(--textDim);
          cursor: pointer;
        }
        .iconBtn:hover{ color: var(--text); background: rgba(255,255,255,0.08); }
        .iconBtn.danger:hover{ color: #ff5c7a; border-color: rgba(255,92,122,0.45); background: rgba(255,92,122,0.10); }
        .iconBtn.small{ width: 30px; height: 30px; border-radius: 9px; }
        .sortDd .ddBtn{ color: var(--textDim); font-size: 13px; }
        .ddBtn.hasValues{ color: var(--accent); border-color: rgba(0,255,191,0.35); }
        .ddCheck{ display:flex; align-items:center; gap: 8px; }
        .ddBox{
          width: 16px; height: 16px; flex:none;
          border: 1px solid var(--border); border-radius: 5px;
          display:grid; place-items:center; font-size: 11px; color: var(--accent);
        }
        .ddCheck.active .ddBox{ border-color: rgba(0,255,191,0.6); background: rgba(0,255,191,0.12); }
        .selCount{ color: var(--accent); font-size: 13px; white-space: nowrap; display:flex; align-items:center; gap: 6px; }
        .linkBtn{ background: none; border: none; color: var(--textDim); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; padding: 0; }
        .linkBtn:hover{ color: var(--text); }
        .headerRow{ display:flex; align-items:center; justify-content:space-between; gap: 10px; }
        .migrateBox{
          margin: 4px 4px 12px;
          padding: 12px;
          border: 1px dashed rgba(0,255,191,0.35);
          border-radius: 14px;
          background: rgba(0,255,191,0.05);
        }
        .migrateBox code{ color: var(--accent); font-size: 12px; }

        /* Confirmation box */
        .modalBackdrop{
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.55);
          display:grid; place-items:center;
        }
        .modal{
          width: min(440px, 90vw);
          border: 1px solid var(--border);
          border-radius: 18px;
          background: #181818;
          box-shadow: 0 24px 60px rgba(0,0,0,0.7);
          padding: 18px;
        }
        .modalTitle{ font-weight: 800; font-size: 16px; margin-bottom: 10px; }
        .modalTrack{ font-weight: 700; word-break: break-word; }
        .modalHint{ color: var(--textDim); font-size: 12px; margin-top: 6px; }
        .modalActions{ display:flex; justify-content:flex-end; gap: 10px; margin-top: 18px; }
        .primaryBtn{ border-color: rgba(0,255,191,0.45); background: rgba(0,255,191,0.12); color: var(--accent); }
        .primaryBtn:hover{ background: rgba(0,255,191,0.20); }
        .fieldLabel{ display:block; color: var(--textDim); font-size: 12px; margin: 10px 0 4px; }
        .fieldInput{ width: 100%; }
        .dangerBtn{ border-color: rgba(255,92,122,0.45); background: rgba(255,92,122,0.12); color: #ff8aa0; }
        .dangerBtn:hover{ background: rgba(255,92,122,0.22); }
        .volume{ display:flex; align-items:center; gap: 6px; }
        .volRange{ width: 90px; }
        .downloadLogs{
          margin: 0 16px 12px 16px;
          border: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
          border-radius: 14px;
          max-height: 180px;
          overflow:auto;
        }
        .downloadLogs pre{
          margin: 0;
          padding: 10px 12px;
          font-size: 12px;
          color: var(--textDim);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .pathLine{
          padding: 0 16px 12px 16px;
          color: var(--textDim);
          font-size: 13px;
        }
        .content{
          flex:1;
          display:grid;
          grid-template-columns: 320px 1fr;
          gap:16px;
          padding: 0 16px 16px 16px;
          min-height: 0;
        }
        .panel{
          border:1px solid var(--border);
          background: rgba(0,0,0,0.22);
          border-radius: 18px;
          overflow:hidden;
          min-height:0;
          display:flex;
          flex-direction:column;
        }
        .panelHeader{
          flex:none;
          padding:12px 14px;
          font-weight:700;
          border-bottom:1px solid var(--border);
          background: rgba(255,255,255,0.03);
        }
        /* The list takes whatever height is left AFTER the header/search row;
           sizing it to the whole panel hid the last item under the panel edge. */
        .list{
          flex:1;
          min-height:0;
          padding:10px;
          overflow:auto;
        }
        .pill{
          padding:10px 12px;
          border-radius: 14px;
          cursor:pointer;
          border:1px solid transparent;
          color: var(--text);
          margin-bottom: 8px;
          background: rgba(255,255,255,0.03);
        }
        .pill.active{
          border-color: rgba(0,255,191,0.35);
          background: rgba(0,255,191,0.10);
        }
        .panelHeader.tabs{ display:flex; gap: 6px; padding: 8px 10px; }
        .tab{
          border: 1px solid transparent;
          background: transparent;
          color: var(--textDim);
          font: inherit; font-weight: 700;
          padding: 5px 10px;
          border-radius: 10px;
          cursor: pointer;
        }
        .tab.active{ color: var(--text); background: rgba(255,255,255,0.06); border-color: var(--border); }
        .tabCount{ color: var(--textDim); font-weight: 500; font-size: 12px; margin-left: 4px; }
        .artistPill{ display:flex; justify-content:space-between; align-items:center; gap: 10px; }
        .artistName{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .artistCount{ color: var(--textDim); font-size: 12px; flex:none; }
        .accentText{ color: var(--accent); }
        .dimText{ color: var(--textDim); font-weight: 500; }
        .searchRow{
          flex:none;
          padding: 10px;
          border-bottom:1px solid var(--border);
          display:flex;
          gap:10px;
          align-items:center;
          background: rgba(0,0,0,0.10);
        }
        .search{
          flex:1;
          border:1px solid var(--border);
          background: rgba(0,0,0,0.18);
          color: var(--text);
          padding: 10px 12px;
          border-radius: 14px;
          outline:none;
        }
        .trackRow{
          padding:10px 12px;
          border-radius: 14px;
          cursor:pointer;
          border:1px solid transparent;
          background: rgba(255,255,255,0.02);
          margin-bottom:8px;
        }
        .trackRow{ user-select: none; }
        .trackRow.selected{
          border-color: rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.07);
        }
        .trackRow.active{
          border-color: rgba(140,25,255,0.35);
          background: rgba(140,25,255,0.10);
        }
        .trackRow.active.selected{
          border-color: rgba(140,25,255,0.6);
        }

        .player{
          border-top:1px solid var(--border);
          padding: 12px 16px;
          background: rgba(0,0,0,0.25);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        /* Now-playing never grows with the title: fixed share of the bar, one line, ellipsis. */
        .nowPlaying{
          display:flex;
          flex-direction:column;
          gap: 2px;
          flex: 0 1 280px;
          min-width: 180px;
          max-width: 34%;
          /* no overflow:hidden here: it would clip the "Move to…" popup; the children clip themselves */
        }
        .nowPlaying{ flex-direction: row; align-items: center; gap: 10px; }
        .npText{ display:flex; flex-direction:column; gap: 2px; min-width: 0; flex: 1; }
        .npArt{
          width: 46px; height: 46px; flex:none; border-radius: 10px; overflow:hidden;
          background: rgba(255,255,255,0.05); border: 1px solid var(--border);
          display:grid; place-items:center; color: rgba(0,255,191,0.35); font-size: 20px;
        }
        .npArt img{ width:100%; height:100%; object-fit: cover; display:block; }
        .miniArt{
          width: 42px; height: 42px; flex:none; border-radius: 9px; overflow:hidden;
          background: rgba(255,255,255,0.05); border: 1px solid var(--border);
          display:grid; place-items:center; color: rgba(0,255,191,0.35); font-size: 18px;
        }
        .miniArt img{ width:100%; height:100%; object-fit: cover; display:block; }
        .mPlayerArt.hasArt{ padding: 8px 0; }
        .mPlayerArt img{
          width: min(78vw, 100%); max-height: 100%; aspect-ratio: 1; object-fit: cover;
          border-radius: 22px; border: 1px solid var(--border);
          box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03);
        }
        .npTitle{ font-weight:800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .npSub{ color: var(--textDim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .controls{
          display:flex;
          align-items:center;
          gap: 10px;
          flex: none;
        }
        .circle{
          width: 44px;
          height: 44px;
          border-radius: 999px;
          border:1px solid var(--border);
          background: rgba(255,255,255,0.06);
          color: var(--text);
          display:grid;
          place-items:center;
          cursor:pointer;
          padding: 0;
        }
        .circle svg{ display:block; }
        /* The timeline always keeps a usable width; it never gets crushed by its neighbours. */
        .timeline{
          flex: 1 1 260px;
          min-width: 260px;
          display:flex;
          align-items:center;
          gap: 10px;
        }
        .time{ color: var(--textDim); font-size: 12px; min-width: 44px; text-align:center; flex:none; }
        /* Sliders: thin purple fill on a faint track, small glowing thumb; no native blue, no white. */
        .range{
          width: 100%; min-width: 0;
          -webkit-appearance: none; appearance: none;
          height: 4px; border-radius: 999px; outline: none; margin: 0;
          background: linear-gradient(90deg, #b06cff 0%, #8c19ff var(--p, 0%), rgba(255,255,255,0.10) var(--p, 0%));
        }
        .range::-webkit-slider-thumb{
          -webkit-appearance: none;
          width: 14px; height: 14px; border-radius: 999px;
          background: #d2b4ff;
          border: 2px solid #0f0f0f;
          box-shadow: 0 0 0 3px rgba(140,25,255,0.28);
          cursor: pointer;
        }
        .range::-moz-range-thumb{
          width: 14px; height: 14px; border-radius: 999px;
          background: #d2b4ff; border: 2px solid #0f0f0f;
          box-shadow: 0 0 0 3px rgba(140,25,255,0.28);
        }
        .range::-moz-range-track{ background: transparent; }
        .app.mobile .range{ height: 5px; }
        .app.mobile .range::-webkit-slider-thumb{ width: 18px; height: 18px; }
        .rightInfo{
          display:flex;
          align-items:center;
          gap: 10px;
          color: var(--textDim);
          font-size: 12px;
          flex: none;
          white-space: nowrap;
          justify-content:flex-end;
        }
        /* Narrow window: the timeline takes a full second row under the other controls. */
        @media (max-width: 980px){
          .timeline{ order: 10; flex: 1 1 100%; min-width: 0; }
          .nowPlaying{ max-width: 46%; }
        }
        /* ---------- Phone layout (class "mobile" on .app; desktop untouched) ---------- */
        .app.mobile{ position: relative; }
        .app.mobile .topbar{ padding: 10px 12px; }
        .app.mobile .brand{ font-size: 18px; gap: 8px; }
        .app.mobile .status{ font-size: 11px; padding: 5px 9px; max-width: 48%; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .app.mobile .pathLine{ display:none; }
        .mSettings{ display:flex; flex-wrap: wrap; gap: 8px; align-items:center; padding: 0 12px 10px; }
        .mSettings .downloadInput{ flex: 1 1 160px; min-width: 0; }
        .mFolder{ flex: 1 1 100%; color: var(--textDim); font-size: 12px; word-break: break-all; }
        .queueAdd{ flex: 1 1 100%; display:flex; gap: 8px; align-items:center; margin-top: 4px; }
        .queueAdd .downloadInput{ flex: 1; min-width: 0; }
        .queueAdd{ flex-wrap: wrap; }
        .mLogs{ flex: 1 1 100%; margin: 4px 0 0; max-height: 140px; }
        .queueBox{ flex: 1 1 100%; margin-top: 4px; border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; background: rgba(0,0,0,0.25); }
        .queueTitle{ font-weight: 700; margin-bottom: 8px; }
        .queueRow{ display:flex; align-items:center; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05); }
        .queueRow.fresh .queueUrl{ color: var(--accent); }
        .queueUrl{ flex: 1; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .app.mobile .content{ display:flex; flex-direction:column; padding: 0 10px 10px; gap: 0; }
        .app.mobile .panel{ flex: 1; border-radius: 16px; }
        .app.mobile .panelHeader{ padding: 10px 12px; }
        .app.mobile .headerRow{ justify-content: flex-start; }
        .app.mobile .headerTitle{ flex: 1; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .app.mobile .searchRow{ flex-wrap: wrap; gap: 8px; padding: 8px 10px; }
        .app.mobile .search{ flex: 1 1 120px; min-width: 0; }
        .app.mobile .pill{ padding: 13px 14px; margin-bottom: 6px; }
        .app.mobile .trackRow{ display:flex; align-items:center; gap: 10px; padding: 11px 14px; margin-bottom: 6px; }
        .rowMain{ flex: 1; min-width: 0; overflow:hidden; text-overflow: ellipsis; }
        .rowSub{ color: var(--textDim); font-size: 12px; margin-top: 2px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rowTick{
          width: 22px; height: 22px; flex:none;
          border: 1px solid var(--border); border-radius: 7px;
          display:grid; place-items:center; font-size: 13px; color: var(--accent);
        }
        .rowTick.on{ border-color: rgba(0,255,191,0.6); background: rgba(0,255,191,0.12); }
        .app.mobile .ddMenu{ max-width: 88vw; }
        .app.mobile .modal{ width: min(440px, 94vw); }
        .mBottom{
          position: relative; z-index: 70; flex:none;
          border-top: 1px solid var(--border);
          background: #141414;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .miniBar{ display:flex; align-items:center; gap: 10px; padding: 8px 12px; cursor:pointer; }
        .miniInfo{ flex: 1; min-width: 0; display:flex; flex-direction:column; gap: 2px; }
        .miniBar .circle{ width: 40px; height: 40px; flex:none; }
        .miniProgress{ height: 2px; background: rgba(255,255,255,0.08); }
        .miniProgress > div{ height: 100%; background: var(--accent); transition: width .25s linear; }
        .tabBar{ display:flex; }
        .tabBtn{
          flex: 1; background: none; border: none;
          color: var(--textDim); font: inherit; font-size: 12px; font-weight: 700;
          padding: 11px 4px 12px; cursor:pointer;
        }
        .tabBtn.active{ color: var(--accent); }
        .tabBtn:disabled{ opacity: 0.35; }
        .mPlayer{
          position: absolute; inset: 0 0 var(--mBottomH, 80px) 0; z-index: 60;
          display:flex; flex-direction:column; gap: 14px;
          padding: 16px 18px 18px;
          background: radial-gradient(700px 500px at 50% 0%, rgba(140,25,255,0.16), transparent 60%),
                      radial-gradient(600px 400px at 50% 100%, rgba(0,255,191,0.10), transparent 60%),
                      var(--bg0);
        }
        .mPlayerTop{ display:flex; align-items:center; justify-content:space-between; gap: 10px; }
        .mPlayerFrom{ flex: 1; min-width: 0; text-align:center; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mPlayerArt{ flex: 1; min-height: 0; display:grid; place-items:center; font-size: 110px; color: rgba(0,255,191,0.22); }
        .mPlayerTitle{ font-size: 21px; font-weight: 800; text-align:center; word-break: break-word; }
        .mPlayerSub{ color: var(--textDim); text-align:center; min-height: 1.2em; }
        .app.mobile .timeline{ flex: none; min-width: 0; }
        .mPlayerControls{ display:flex; align-items:center; justify-content:center; gap: 14px; }
        .mPlayerControls .circle{ width: 52px; height: 52px; font-size: 18px; }
        .circle.big{
          width: 68px !important; height: 68px !important; font-size: 24px !important;
          border-color: rgba(0,255,191,0.45); background: rgba(0,255,191,0.12); color: var(--accent);
        }
        .mPlayerAdd{ display:flex; justify-content:center; }
        .mPlayerAdd .ddMenu{ left: 50%; transform: translateX(-50%); }
        /* Scrollbars */
        * {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) rgba(0,0,0,0.25);
        }

        *::-webkit-scrollbar { width: 10px; height: 10px; }
        *::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.25);
          border-radius: 999px;
        }
        *::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.16);
          border-radius: 999px;
          border: 2px solid rgba(0,0,0,0.25);
        }
        *::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.24);
        }
      `;
