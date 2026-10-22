"""Device-only IPC fixture; never installed as a production execution adapter."""
import json
import sys
import time

mode = sys.argv[1]
if mode == 'echo':
    # Keep the following request alive while a previous timed-out callback arrives.
    time.sleep(2)
    print(json.dumps({'argument': sys.argv[2], 'stdin': sys.stdin.read()}))
elif mode == 'failure':
    print('fixture stdout')
    print('fixture stderr', file=sys.stderr)
    sys.exit(7)
elif mode == 'delay':
    time.sleep(2)
    print('late fixture result')
else:
    sys.exit(64)
