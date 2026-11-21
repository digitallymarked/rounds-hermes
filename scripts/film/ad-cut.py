# The ad: words and takes laid end to end on the beat (a beat is 25 frames at 144 bpm), hard cuts,
# over the track from score.mjs.
#   python3 scripts/film/ad-cut.py <desktop|phone> <takes dir> <paper.mp4> <score.wav> <out.mp4> [ad|updates]
import os, re, subprocess, sys

view, SRC, PAPER, SCORE, OUT = sys.argv[1:6]
CUT = sys.argv[6] if len(sys.argv) > 6 else "ad"
W, H = (1920, 1080) if view == "desktop" else (1080, 1350)
B = 25
TMP = os.path.join(SRC, f"cut-{CUT}-{view}")
os.makedirs(TMP, exist_ok=True)
ENC = ["-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-r", "60"]

# what plays, beat by beat: a word (w, u), a take, or the end; the ad, and the film of what's new in 1.1
CUTS = {
    "ad": [
        ("w1", 1), ("w2", 1), ("w3", 2),
        ("reveal", 4),
        ("lands", 1), ("sky", 1), ("dawn", 1), ("night", 1),
        ("w4", 1), ("open", 1), ("morph", 2),
        ("w5", 1), ("pin", 1), ("note", 2),
        ("w6", 1), ("answer", 1), ("pair", 2),
        ("w7", 1), ("find", 1), ("alone", 2),
        ("w8", 1), ("sheet", 1), ("page", 2),
        ("w9", 1), ("stack", 1), ("days", 2),
        ("w10", 1), ("flick", 1), ("july", 2),
        ("end", 12),
    ],
    "updates": [
        ("u1", 1), ("u2", 1), ("u3", 2),
        ("reveal", 4),
        ("u4", 1), ("find", 1), ("alone", 2),
        ("u5", 1), ("sheet", 1), ("page", 2),
        ("u6", 1), ("open", 1), ("morph", 2),
        ("u7", 1), ("stack", 1), ("days", 2),
        ("u8", 1), ("flick", 1), ("july", 2),
        ("end", 12),
    ],
}
SEQ = CUTS[CUT]


def run(args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y"] + args, check=True)


parts, paper_at = [], 0.3
for i, (name, beats) in enumerate(SEQ):
    n = beats * B
    out = f"{TMP}/{i:02d}-{name}.mp4"
    if re.fullmatch(r"[wu]\d+|end", name):
        # the paper, a different stretch of it each time, with the words drawn frame by frame on it
        seq = os.path.join(SRC, f"{view}-{name}", "%04d.png")
        run(["-ss", f"{paper_at:.3f}", "-i", PAPER, "-framerate", "60", "-i", seq, "-frames:v", str(n), "-filter_complex",
             f"[1]scale={W}:{H}:flags=lanczos,format=rgba[t];[0][t]overlay=0:0:eof_action=repeat"] + ENC + [out])
        paper_at = (paper_at + 0.37) % 3.4
    else:
        run(["-i", os.path.join(SRC, f"{view}-ad-{name}.mp4"), "-frames:v", str(n), "-vf", f"tpad=stop_mode=clone:stop={n}"] + ENC + [out])
    parts.append(out)

with open(f"{TMP}/list.txt", "w") as f:
    f.writelines(f"file '{p}'\n" for p in parts)
frames = sum(b for _, b in SEQ) * B
run(["-f", "concat", "-safe", "0", "-i", f"{TMP}/list.txt", "-i", SCORE, "-frames:v", str(frames),
     "-af", "equalizer=f=70:t=q:w=0.9:g=-4,equalizer=f=2800:t=q:w=0.8:g=5,equalizer=f=9000:t=q:w=1:g=-2,alimiter=limit=0.89:level=false",
     "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "60",
     "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", OUT])
print(view, frames / 60, "s", round(os.path.getsize(OUT) / 1e6, 1), "MB")
