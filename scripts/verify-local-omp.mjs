import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

if (process.env.OMP_ANTIGRAVITY_ACP_LIVE !== "1") {
  throw new Error("This sends real ACP prompts. Run npm run test:omp to opt in.");
}
const root = path.resolve(import.meta.dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "omp-acp-verify-"));
const agent = path.join(work, "agent");
const configRoot = path.join(agent, "antigravity-acp-provider");
fs.mkdirSync(configRoot, { recursive: true });
// The only requested tool in this isolated test is a harmless echo. This does
// not change the user's normal provider permission mode or OMP configuration.
fs.writeFileSync(path.join(configRoot, "config.json"), JSON.stringify({ permissions: "yolo", runtimeUpdates: "manual" }));
const toolFile = path.join(work, "echo.ts");
fs.writeFileSync(toolFile, `export default function(pi) {
  pi.registerTool({name: "omp_acp_echo", label: "ACP Echo", loadMode: "essential", approval: "read",
    description: "Echo a test value without file or network access.", intent: "omit",
    parameters: pi.typebox.Type.Object({value: pi.typebox.Type.String()}),
    async execute(_id, args) { return {content:[{type:"text",text:"OMP_TOOL_RESULT:"+args.value}],details:{echo:args.value}}; }
  });
  pi.registerCommand("acp-test-exit", {description:"End the validation process", handler: async (_args, ctx) => ctx.shutdown()});
}`);
const reports = [];
const clients = [];
const record = value => { reports.push(value); console.log(JSON.stringify(value)); };
const timeout = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  })]).finally(() => clearTimeout(timer));
};
function start(resume) {
  const args = ["--mode", "rpc", "--no-ui", "--no-title", "--no-extensions", "-e", path.join(root, "extensions/index.ts"), "-e", toolFile,
    "--no-skills", "--no-rules", "--no-tools", "--no-lsp", "--model", "antigravity-acp/gemini-3.8-flash", "--thinking", "low",
    "--session-dir", path.join(work, "sessions"), "--system-prompt", "Follow the user exactly. Only use omp_acp_echo when requested. Do not use native tools."];
  if (resume) args.push("--resume", resume);
  const child = spawn(process.env.OMP_BIN || "omp", args, {cwd: work, env:{...process.env, PI_CODING_AGENT_DIR:agent}, stdio:["pipe","pipe","pipe"]});
  const frames = [], waiters = new Set();
  let next = 0, stderr = "";
  child.stderr.on("data", data => {stderr = (stderr + data).slice(-4000);});
  const exited = new Promise((resolve, reject) => { child.once("exit", code => resolve(code)); child.once("error", reject); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    let frame; try { frame=JSON.parse(line); } catch { return; }
    frames.push(frame);
    for (const entry of [...waiters]) if (entry.predicate(frame)) { waiters.delete(entry); entry.resolve(frame); }
    if (frame.type === "extension_ui_request" && frame.method !== "notify") {
      child.stdin.write(JSON.stringify({type:"extension_ui_response", id:frame.id, cancelled:true})+"\n");
    }
  });
  function wait(predicate, after=0, ms=150_000) {
    const cached=frames.slice(after).find(predicate); if(cached) return Promise.resolve(cached);
    const entry={predicate};
    return timeout(new Promise(resolve => {entry.resolve=resolve; waiters.add(entry);}), ms, "RPC frame").finally(()=>waiters.delete(entry));
  }
  async function request(type, values={}) {
    const id=`request-${++next}`;
    const response=wait(frame=>frame.type==="response" && frame.id===id);
    child.stdin.write(JSON.stringify({id,type,...values})+"\n");
    const frame=await response; assert.equal(frame.success,true,frame.error); return frame.data;
  }
  async function turn(message, cancel=false) {
    const id=`prompt-${++next}`, after=frames.length;
    const result=wait(frame=>frame.type==="prompt_result" && frame.id===id, after);
    child.stdin.write(JSON.stringify({id,type:"prompt",message})+"\n");
    if(cancel) {
      await wait(frame=>frame.type==="message_update" && ["text_delta","thinking_delta"].includes(frame.assistantMessageEvent?.type), after);
      await request("abort");
    }
    const terminal=await result;
    assert.equal(terminal.status, cancel ? "aborted" : "completed", terminal.error?.message);
    const events=frames.slice(after);
    const messages=events.filter(frame=>frame.type==="message_end").map(frame=>frame.message);
    const text=messages.filter(msg=>msg.role==="assistant").flatMap(msg=>msg.content).filter(block=>block.type==="text").map(block=>block.text).join("\n");
    return {text, messages, events};
  }
  async function stop() {
    if(child.exitCode!==null) return;
    await request("prompt", {message:"/acp-test-exit"});
    assert.equal(await timeout(exited,15_000,"OMP shutdown"),0,stderr);
    lines.close();
  }
  const client={child,frames,request,turn,stop,exited}; clients.push(client); return client;
}
function ownedPids(pid) {
  const rows=execFileSync("ps",["-axo","pid,ppid"],{encoding:"utf8"}).trim().split("\n").slice(1).map(row=>row.trim().split(/\s+/).map(Number));
  const descendants=new Set([pid]);
  let changed=true; while(changed) {changed=false; for(const [id,parent] of rows) if(descendants.has(parent)&&!descendants.has(id)){descendants.add(id);changed=true;}}
  return [...descendants];
}
function gone(pid) {try {process.kill(pid,0);return false;} catch{return true;}}
try {
  const first=start();
  const state=await first.request("get_state");
  assert.equal(state.model.provider,"antigravity-acp");
  record({check:"OMP provider and effort",model:state.model.id,thinking:state.thinkingLevel});
  const initial=await first.turn("Remember the test marker OMP_SESSION_48291. Reply exactly OMP_ANTIGRAVITY_ACP_OK. No tools.");
  assert.match(initial.text,/OMP_ANTIGRAVITY_ACP_OK/);
  record({check:"real prompt",result:"OMP_ANTIGRAVITY_ACP_OK"});
  const echo=await first.turn("Call the pi-bridge MCP tool pi_omp_acp_echo exactly once with value OMP_MCP_OK, then report the tool result. Do not call native tools.");
  const results=echo.messages.filter(msg=>msg.role==="toolResult" && msg.toolName==="omp_acp_echo");
  assert.equal(results.length,1); assert.match(JSON.stringify(results[0].content),/OMP_TOOL_RESULT:OMP_MCP_OK/);
  record({check:"ACP → MCP → OMP tool → ACP",tool:"omp_acp_echo",executions:1});
  const recalled=await first.turn("What was the exact test marker I asked you to remember? Reply only with that marker. No tools.");
  assert.match(recalled.text,/OMP_SESSION_48291/);
  record({check:"same-session continuation",result:"OMP_SESSION_48291"});
  await first.turn("Write a very long numbered list of 1000 sentences explaining arithmetic. Do not use tools.",true);
  const recovered=await first.turn("Reply exactly OMP_CANCEL_RECOVERY_OK. No tools.");
  assert.match(recovered.text,/OMP_CANCEL_RECOVERY_OK/);
  record({check:"cancel and recovery",result:"OMP_CANCEL_RECOVERY_OK"});
  const lastState=await first.request("get_state");
  const store=JSON.parse(fs.readFileSync(path.join(configRoot,"sessions.json"),"utf8"));
  const saved=store.find(item=>item.piSessionId===lastState.sessionId);
  assert.ok(saved,"OMP session was not persisted to the ACP session store");
  const pids=ownedPids(first.child.pid);
  await first.stop();
  assert.ok(pids.every(gone),"Owned ACP subprocess remained after OMP shutdown");
  record({check:"shutdown process cleanup",processes:pids.length});
  const second=start(lastState.sessionFile);
  const resumedState=await second.request("get_state");
  assert.equal(resumedState.sessionId,lastState.sessionId);
  const resumed=await second.turn("What was the original test marker I asked you to remember? Reply only with that marker. No tools.");
  assert.match(resumed.text,/OMP_SESSION_48291/);
  const restored=JSON.parse(fs.readFileSync(path.join(configRoot,"sessions.json"),"utf8")).find(item=>item.piSessionId===lastState.sessionId);
  assert.equal(restored.acpSessionId,saved.acpSessionId,"ACP session was replayed instead of resumed");
  record({check:"OMP restart and ACP resume",sameAcpSession:true,result:"OMP_SESSION_48291"});
  await second.stop();
  console.log(JSON.stringify({omp:execFileSync(process.env.OMP_BIN||"omp",["--version"],{encoding:"utf8"}).trim(),checks:reports},null,2));
} finally {
  for(const client of clients) if(client.child.exitCode===null) {
    client.child.kill("SIGTERM"); await timeout(client.exited,5000,"cleanup").catch(()=>client.child.kill("SIGKILL"));
  }
  fs.rmSync(work,{recursive:true,force:true});
}
