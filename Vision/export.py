"""Export all checkpoints and evaluate the actual ONNX files on withheld families."""
import hashlib
import json
from pathlib import Path
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
training = ROOT / "artifacts" / "training"
destination = ROOT / "public" / "models"
destination.mkdir(parents=True, exist_ok=True)
report = json.loads((training / "training.json").read_text(encoding="utf-8"))
heldout = np.load(training / "heldout.npz")
report["checkpoints"] = {}
for stage in ("early", "middle", "mature"):
    weights = np.load(training / (stage + ".npz"))
    nodes = []
    inputs = []
    previous = "image"
    for idx, operation in enumerate(("Conv", "Relu", "MaxPool", "Conv", "Relu", "MaxPool",
                                      "Flatten", "Gemm", "Relu", "Gemm")):
        args = [previous]
        options = {}
        if operation in ("Conv", "Gemm"):
            for param in ("weight", "bias"):
                name = f"{idx}.{param}"
                inputs.append(numpy_helper.from_array(weights[name], name))
                args.append(name)
            options = {"pads": [1, 1, 1, 1]} if operation == "Conv" else {"transB": 1}
        if operation == "MaxPool":
            options = {"kernel_shape": [2, 2], "strides": [2, 2]}
        previous = "logits" if idx == 9 else f"layer{idx}"
        nodes.append(helper.make_node(operation, args, [previous], **options))
    graph = helper.make_graph(nodes, "AeroMind roof signs", [
        helper.make_tensor_value_info("image", TensorProto.FLOAT, ["batch", 1, 24, 24])], [
        helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", 6])], inputs)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=9)
    onnx.checker.check_model(model)
    path = destination / (stage + ".onnx")
    onnx.save(model, path)
    opt = ort.SessionOptions()
    opt.intra_op_num_threads = 2
    session = ort.InferenceSession(str(path), opt, providers=["CPUExecutionProvider"])
    predicted = session.run(None, {"image": heldout["images"]})[0].argmax(1)
    matrix = np.zeros((6, 6), dtype=int)
    np.add.at(matrix, (heldout["labels"], predicted), 1)
    report["checkpoints"][stage] = {
        "accuracy": float(np.mean(predicted == heldout["labels"])), "confusion": matrix.tolist(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
(destination / "training.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print({k: v["accuracy"] for k, v in report["checkpoints"].items()})
