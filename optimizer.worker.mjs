// Фоновый поток: полный перебор не блокирует интерфейс.
import { applyModel, fullModelFingerprint } from "./data.mjs";
import { analyzeSpace, reallocate } from "./optimizer.mjs";

let applied = fullModelFingerprint();

self.onmessage = ({ data }) => {
  try {
    // У воркера своя копия модулей: модель из настроек передаётся вместе с задачей.
    if (data.model && fullModelFingerprint(data.model) !== applied) {
      applyModel(data.model);
      applied = fullModelFingerprint(data.model);
    }
    if (data.type === "space") {
      const space = analyzeSpace({ insurance: data.insurance });
      self.postMessage({ id: data.id, result: space }, space.sorted ? [space.sorted.buffer] : []);
    } else if (data.type === "reallocate") {
      self.postMessage({ id: data.id, result: reallocate(data.decisions, data.eventId) });
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error) });
  }
};
