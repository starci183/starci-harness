// The host doctor's docker seam takes only light calls: inspection, container and network control, and its --rm probe container.
// A build, a compose call or any other run is refused, so the doctor never spawns a heavy command outside the governor.
import assert from "node:assert/strict"
import test from "node:test"
import { lightDockerArgs } from "./host-doctor.js"

void test("the doctor's docker seam passes inspection, control and the --rm probe", () => {
    for (const args of [["ps", "-a", "-q"], ["inspect", "abc"], ["info", "--format", "{{.ServerVersion}}"], ["network", "connect", "n", "c"], ["restart", "--time", "10", "c"], ["stop", "c"], ["rm", "-f", "c"]])
        assert.deepEqual(lightDockerArgs(args), args)
    const probe = ["run", "--rm", "--name", "p", "--network", "n", "--entrypoint", "sh", "busybox", "-c", "true"]
    assert.deepEqual(lightDockerArgs(probe), probe)
})

void test("the doctor's docker seam refuses a build, a compose call and a run that is not the probe", () => {
    for (const args of [["build", "."], ["compose", "up", "-d"], ["run", "-d", "image"], ["run", "--rm", "image"], []])
        assert.throws(() => lightDockerArgs(args), /only light docker calls/)
})
