const si = require('systeminformation');

async function getSystemResources(containerResources = {}) {
    const mem = await si.mem();
    const disks = await si.fsSize();
    const disk = disks.reduce((a, b) => (a.size > b.size ? a : b), { size: 0, available: 0 });
    const graphics = await si.graphics();
    const cpu = await si.cpu();

    let usedRam = 0;
    let usedStorage = 0;
    let usedCpu = 0;
    let usedGpus = 0;

    for (const res of Object.values(containerResources)) {
        usedRam += res.ram || 0;
        usedStorage += res.storage || 0;
        usedCpu += res.cpu || 0;
        if (res.gpu) usedGpus += 1;
    }

    return {
        totalRam: mem.total,
        availableRam: Math.max(0, mem.available - usedRam),
        totalStorage: disk.size || 0,
        availableStorage: Math.max(0, (disk.available || 0) - usedStorage),
        gpu: graphics.controllers[0]?.model || 'none',
        totalGpus: graphics.controllers.length,
        usedGpus,
        cpuCores: cpu.cores,
        cpuThreads: cpu.processors || cpu.physicalCores || cpu.cores,
        usedCpu
    };
}

module.exports = { getSystemResources };