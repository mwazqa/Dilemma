import json
import subprocess
import sys


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Verification failed")
    return result.stdout


try:
    container = json.loads(run(["docker", "inspect", "dilemma"]))[0]
    script = """
      import { PrismaClient } from '@prisma/client';
      const db = new PrismaClient();
      try {
        const result = await db.$queryRawUnsafe('SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user');
        console.log(JSON.stringify({ databaseRead: true, uid: process.getuid(), databaseSuperuser: result[0].rolsuper, databaseCreateRoles: result[0].rolcreaterole, databaseCreateDatabases: result[0].rolcreatedb, databaseBypassRls: result[0].rolbypassrls }));
      } catch { console.log(JSON.stringify({databaseRead:false})); process.exitCode=1; }
      finally { await db.$disconnect(); }
    """
    database = json.loads(run(["docker", "exec", "dilemma", "node", "--input-type=module", "-e", script]).strip())
    print(json.dumps({
        "running": container["State"]["Running"], "restarts": container["RestartCount"],
        "non_root_user": container["Config"]["User"] == "node" and database.get("uid", 0) != 0,
        "read_only_filesystem": container["HostConfig"]["ReadonlyRootfs"],
        "all_capabilities_dropped": "ALL" in (container["HostConfig"]["CapDrop"] or []),
        "no_new_privileges": "no-new-privileges:true" in (container["HostConfig"]["SecurityOpt"] or []),
        "published_port_groups": len(container["HostConfig"]["PortBindings"] or {}),
        "database_read": database["databaseRead"], "database_superuser": database["databaseSuperuser"],
        "database_create_roles": database["databaseCreateRoles"], "database_create_databases": database["databaseCreateDatabases"],
        "database_bypass_rls": database["databaseBypassRls"]
    }))
except Exception:
    print('{"verification_failed":true}')
    sys.exit(1)
