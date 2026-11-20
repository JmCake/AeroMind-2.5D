"""Small, reproducible team-corridor MDP. Actions are game choices, not flight controls."""
import json
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]


def episode(rng, q, learn, epsilon):
    hidden = rng.choice(("clear", "temporary", "closed"))
    remaining = rng.randrange(2, 7)
    urgent, teammate = rng.randrange(2), rng.randrange(2)
    evidence, total = 0, 0
    for step in range(12):
        state = evidence * 4 + urgent * 2 + teammate
        action = rng.randrange(3) if rng.random() < epsilon else max(range(3), key=q[state].__getitem__)
        # Wait, request a fresh view, or take another published corridor.
        reward, done = -1.0 - urgent * .45, False
        if action == 0:
            if hidden == "clear":
                reward, done = 6.0, True
            elif hidden == "temporary":
                remaining -= 1
                if remaining <= 0:
                    hidden, evidence = "clear", 1
        elif action == 1:
            reward = -.7 if teammate else -1.5
            evidence = {"clear": 1, "temporary": 2, "closed": 3}[hidden]
        else:
            reward, done = (2.0 if hidden == "closed" else -2.0) - urgent * .25, True
        if step == 11 and not done:
            reward, done = -8.0, True
        total += reward
        nxt = evidence * 4 + urgent * 2 + teammate
        if learn:
            target = reward + (0 if done else .90 * max(q[nxt]))
            q[state][action] += .065 * (target - q[state][action])
        if done:
            break
    return total


if __name__ == "__main__":
    rng = random.Random(741)
    q = [[0.0, 0.0, 0.0] for _ in range(16)]
    results = {}
    for count in range(1, 24001):
        episode(rng, q, True, max(.07, .7 * (1 - count / 24000)))
        if count in (8, 960, 24000):
            test = random.Random(9917)
            scores = [episode(test, q, False, 0) for _ in range(500)]
            results[{8:"early", 960:"middle", 24000:"mature"}[count]] = {
                "episodes": count, "q": [[round(v, 5) for v in row] for row in q],
                "mean_test_return": sum(scores) / len(scores)}
    path = ROOT / "public" / "models" / "policy.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"seed":741, "test_seed":9917, "test_episodes":500, "stages":results},
                                separators=(",", ":")), encoding="utf-8")
