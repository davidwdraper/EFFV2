# deps

npm i -D ts-node adm-zip

# dry run (see plan, no writes)

npx ts-node tools/nv-service-clone.ts --in ./t_entity_crud.zip --slug user --dry-run

# real run (writes the output zip)

npx ts-node tools/nv-service-clone.ts --in ./t_entity_crud.zip --slug user

# custom out dir + overwrite existing

npx ts-node tools/nv-service-clone.ts --in ./t_entity_crud.zip --slug user --out ./out --force
