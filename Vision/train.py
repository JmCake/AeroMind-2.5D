"""Train the tabletop city's roof-sign classifier on CPU. See export.py for ONNX."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[1]
NAMES = ["hub", "library", "clinic", "works", "dorm", "other"]
SEEDS = {"train": list(range(32)), "validation": list(range(100, 110)), "test": list(range(200, 216))}


def draw_sign(label, side=96):
    image = np.full((96, 96, 3), (202, 218, 25), np.uint8)
    cv2.rectangle(image, (9, 9), (86, 86), (44, 39, 21), -1)
    ink = (226, 246, 250)
    if label == 0:
        cv2.circle(image, (48, 48), 20, ink, 9, cv2.LINE_AA)
    elif label == 1:
        for x in (28, 44, 60):
            cv2.rectangle(image, (x, 27), (x + 8, 67), ink, -1)
    elif label == 2:
        cv2.rectangle(image, (41, 25), (55, 70), ink, -1)
        cv2.rectangle(image, (25, 41), (71, 55), ink, -1)
    elif label == 3:
        cv2.polylines(image, [np.array([(48, 24), (72, 67), (24, 67)])], True, ink, 8, cv2.LINE_AA)
    elif label == 4:
        cv2.line(image, (29, 29), (67, 67), ink, 10, cv2.LINE_AA)
        cv2.line(image, (67, 29), (29, 67), ink, 10, cv2.LINE_AA)
    return cv2.resize(image, (side, side), interpolation=cv2.INTER_AREA)


def examples(split, per_family):
    images, labels = [], []
    for family in SEEDS[split]:
        rng = np.random.default_rng(7919 + family)
        # Each family has its own print stock, lens distortion and light palette.
        tint = rng.uniform(0.65, 1.1, 3)
        skew = rng.uniform(-3, 3, (4, 2))
        for idx in range(per_family):
            label = idx % len(NAMES)
            img = draw_sign(label, 32)
            if label == 5:
                for _ in range(int(rng.integers(1, 7))):
                    p = tuple(map(int, rng.integers(4, 28, 2)))
                    q = tuple(map(int, rng.integers(4, 28, 2)))
                    cv2.rectangle(img, p, q, tuple(map(int, rng.integers(15, 240, 3))), -1)
            corners = np.float32([[0, 0], [31, 0], [31, 31], [0, 31]])
            target = np.float32(corners + skew + rng.normal(0, 1.1, (4, 2)))
            img = cv2.warpPerspective(img, cv2.getPerspectiveTransform(corners, target), (32, 32),
                                      borderMode=cv2.BORDER_REPLICATE)
            img = np.rot90(img, int(rng.integers(4))).copy()
            size = int(rng.integers(10, 34))
            img = cv2.resize(cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA), (24, 24))
            img = np.clip(img * tint * rng.uniform(.42, 1.32) + rng.uniform(-9, 26)
                          + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
            images.append(gray)
            labels.append(label)
    return torch.from_numpy(np.array(images)[:, None]), torch.tensor(labels)


def train():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ROOT / "artifacts" / "training")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    assets = ROOT / "public" / "signs"
    assets.mkdir(parents=True, exist_ok=True)
    for idx, name in enumerate(NAMES[:-1]):
        cv2.imwrite(str(assets / (name + ".png")), draw_sign(idx))
    torch.manual_seed(617)
    torch.set_num_threads(3)
    cv2.setNumThreads(1)
    net = nn.Sequential(nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                        nn.Conv2d(8, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                        nn.Flatten(), nn.Linear(576, 32), nn.ReLU(), nn.Linear(32, len(NAMES)))
    optimizer = torch.optim.Adam(net.parameters(), lr=.002)
    x, y = examples("train", 192)
    vx, vy = examples("validation", 60)
    tx, ty = examples("test", 72)
    log = []
    for epoch in range(11):
        losses = []
        net.train()
        for batch, ids in enumerate(torch.randperm(len(x)).split(96)):
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(net(x[ids]), y[ids])
            loss.backward()
            optimizer.step()
            losses.append(loss.item())
            if epoch == 0 and batch == 0:
                np.savez(args.out / "early.npz", **{k: v.detach().numpy() for k, v in net.state_dict().items()})
        net.eval()
        with torch.inference_mode():
            accuracy = (net(vx).argmax(1) == vy).float().mean().item()
        log.append({"epoch": epoch + 1, "loss": float(np.mean(losses)), "val_accuracy": accuracy})
        if epoch in (0, 10):
            name = "middle" if epoch == 0 else "mature"
            np.savez(args.out / (name + ".npz"), **{k: v.detach().numpy() for k, v in net.state_dict().items()})
    np.savez_compressed(args.out / "heldout.npz", images=tx.numpy(), labels=ty.numpy())
    (args.out / "training.json").write_text(json.dumps({
        "seed": 617, "classes": NAMES, "split_families": SEEDS, "samples": [len(x), len(vx), len(tx)],
        "torch": torch.__version__, "device": "cpu", "curve": log,
        "split_unit": "independent print, lens and lighting families",
    }, indent=2), encoding="utf-8")
    print("CPU training finished", log[-1], flush=True)


if __name__ == "__main__":
    train()
