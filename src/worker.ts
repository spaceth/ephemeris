import { craftSession } from "./core/ephemeris/craft";
import { parseOem } from "./core/oem";
import { buildArcs, type WorkerRequest, type WorkerResponse } from "./session";

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;

function post(message: WorkerResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === "parse-spk") {
      const session = craftSession(message.buffer);
      post(
        { type: "parsed", id: message.id, name: message.name, file: session.file, arcs: session.arcs },
        session.arcs.flatMap((arc) => [arc.positions.buffer, arc.times.buffer]),
      );
      return;
    }
    if (message.type !== "parse") return;
    const file = parseOem(message.text);
    const arcs = buildArcs(file);
    post({ type: "parsed", id: message.id, name: message.name, file, arcs }, arcs.flatMap((arc) => [arc.positions.buffer, arc.times.buffer]));
  } catch (error) {
    const text = error instanceof Error ? error.message : "Could not read this file";
    post({ type: "parse-error", id: message.id, message: text });
  }
};
