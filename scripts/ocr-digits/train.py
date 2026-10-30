import gzip, json, base64, math, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(4)
def load(img, lab):
    x = np.frombuffer(gzip.open(img).read(), np.uint8, offset=16).reshape(-1, 28, 28).astype(np.float32) / 255
    y = np.frombuffer(gzip.open(lab).read(), np.uint8, offset=8).astype(np.int64)
    return torch.tensor(x)[:, None], torch.tensor(y)
Xtr, Ytr = load('data/train-images-idx3-ubyte.gz', 'data/train-labels-idx1-ubyte.gz')
Xte, Yte = load('data/t10k-images-idx3-ubyte.gz', 'data/t10k-labels-idx1-ubyte.gz')
Xs = torch.tensor(np.fromfile('data/synth-x.bin', np.uint8).reshape(-1, 1, 28, 28).astype(np.float32) / 255)
Ys = torch.tensor(np.fromfile('data/synth-y.bin', np.uint8).astype(np.int64))
p = torch.randperm(len(Xs)); Xs, Ys = Xs[p], Ys[p]
Xsv, Ysv = Xs[:3000], Ys[:3000]
Xtr = torch.cat([Xtr, Xs[3000:]]); Ytr = torch.cat([Ytr, Ys[3000:]])
print('train size', len(Xtr))

def noise_batch(n):
    # kelas 10 = bukan angka: garis, titik, gumpalan, tanda strip, tekstur
    out = torch.zeros(n, 1, 28, 28)
    yy, xx = torch.meshgrid(torch.arange(28.), torch.arange(28.), indexing='ij')
    for i in range(n):
        k = np.random.randint(5)
        img = torch.zeros(28, 28)
        if k == 0:  # strip / garis datar
            y = np.random.randint(10, 18); w = np.random.randint(8, 22); x0 = np.random.randint(2, 26 - w)
            img[y:y + np.random.randint(2, 5), x0:x0 + w] = 1
        elif k == 1:  # garis miring acak
            for _ in range(np.random.randint(1, 3)):
                a = np.random.rand() * math.pi; c = np.random.rand(2) * 12 + 8
                d = ((xx - c[0]) * math.sin(a) - (yy - c[1]) * math.cos(a)).abs()
                img = torch.maximum(img, (d < np.random.uniform(1, 2.5)).float() * ((xx - c[0]) ** 2 + (yy - c[1]) ** 2 < np.random.uniform(30, 120)).float())
        elif k == 2:  # gumpalan
            c = np.random.rand(2) * 10 + 9; r = np.random.uniform(3, 9)
            img = (((xx - c[0]) ** 2 / r ** 2 + (yy - c[1]) ** 2 / (r * np.random.uniform(0.5, 1.5)) ** 2) < 1).float()
        elif k == 3:  # bintik acak
            img = (torch.rand(28, 28) < np.random.uniform(0.05, 0.2)).float()
        else:  # titik kecil
            c = np.random.rand(2) * 8 + 10; r = np.random.uniform(2, 4)
            img = (((xx - c[0]) ** 2 + (yy - c[1]) ** 2) < r * r).float()
        out[i, 0] = img
    return out

def augment(x):
    n = x.shape[0]
    ang = (torch.rand(n) - 0.5) * 2 * math.radians(14)
    sc = 1 / (0.82 + torch.rand(n) * 0.3)
    shx = (torch.rand(n) - 0.5) * 0.4
    tx = (torch.rand(n) - 0.5) * 0.18; ty = (torch.rand(n) - 0.5) * 0.18
    cos, sin = torch.cos(ang) * sc, torch.sin(ang) * sc
    theta = torch.stack([torch.stack([cos, -sin + shx, tx], 1), torch.stack([sin, cos, ty], 1)], 1)
    g = F.affine_grid(theta, x.shape, align_corners=False)
    x = F.grid_sample(x, g, align_corners=False)
    r = torch.rand(n)
    thick = F.max_pool2d(x, 3, 1, 1)
    thick2 = F.max_pool2d(thick, 3, 1, 1)
    thin = -F.max_pool2d(-x, 3, 1, 1)
    x = torch.where((r < 0.35).view(-1, 1, 1, 1), thick, x)
    x = torch.where(((r >= 0.35) & (r < 0.55)).view(-1, 1, 1, 1), thick2, x)
    x = torch.where(((r >= 0.55) & (r < 0.62)).view(-1, 1, 1, 1), thin, x)
    b = torch.rand(n) < 0.5
    x = torch.where(b.view(-1, 1, 1, 1), (x > 0.45).float(), x)
    x = x + (torch.rand_like(x) < 0.01).float() * (torch.rand(n) < 0.3).float().view(-1, 1, 1, 1)
    return x.clamp(0, 1)

class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.c1 = nn.Conv2d(1, 32, 3, padding=1); s.c2 = nn.Conv2d(32, 64, 3, padding=1); s.c3 = nn.Conv2d(64, 64, 3, padding=1)
        s.f1 = nn.Linear(64 * 3 * 3, 128); s.f2 = nn.Linear(128, 11)
    def forward(s, x):
        x = F.max_pool2d(F.relu(s.c1(x)), 2)
        x = F.max_pool2d(F.relu(s.c2(x)), 2)
        x = F.max_pool2d(F.relu(s.c3(x)), 2)
        x = F.dropout(F.relu(s.f1(x.flatten(1))), 0.3, s.training)
        return s.f2(x)

net = Net(); opt = torch.optim.Adam(net.parameters(), 2e-3)
EP = 10; bs = 128; steps = EP * (len(Xtr) // bs)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps)
for ep in range(EP):
    net.train(); perm = torch.randperm(len(Xtr)); tot = 0; cor = 0
    for i in range(0, len(Xtr) - bs + 1, bs):
        idx = perm[i:i + bs]
        xb = augment(Xtr[idx]); yb = Ytr[idx]
        nz = bs // 10
        xb = torch.cat([xb, noise_batch(nz)]); yb = torch.cat([yb, torch.full((nz,), 10)])
        out = net(xb); loss = F.cross_entropy(out, yb, label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        cor += (out.argmax(1) == yb).sum().item(); tot += len(yb)
    net.eval()
    with torch.no_grad():
        acc = (net(Xte).argmax(1) == Yte).float().mean().item()
        acca = (net(augment(Xte)).argmax(1) == Yte).float().mean().item()
        nacc = (net(noise_batch(1000)).argmax(1) == 10).float().mean().item()
        sacc = (net(Xsv).argmax(1) == Ysv).float().mean().item()
    print(f'ep{ep} train {cor/tot:.4f} test {acc:.4f} test-aug {acca:.4f} noise {nacc:.3f} synth {sacc:.4f}', flush=True)

# Ekspor: bobot int8 per tensor + skala, base64
out = {'v': 1, 'input': 28, 'classes': 11, 'layers': {}}
for name, p in net.state_dict().items():
    a = p.detach().numpy().astype(np.float32)
    if name.endswith('weight'):
        sc = float(np.abs(a).max() / 127) or 1.0
        q = np.clip(np.round(a / sc), -127, 127).astype(np.int8)
        out['layers'][name] = {'shape': list(a.shape), 'scale': sc, 'q': base64.b64encode(q.tobytes()).decode()}
    else:
        out['layers'][name] = {'shape': list(a.shape), 'f': base64.b64encode(a.tobytes()).decode()}
json.dump(out, open('digits-v1.json', 'w'))
torch.save(net.state_dict(), 'net.pt')
print('saved')
