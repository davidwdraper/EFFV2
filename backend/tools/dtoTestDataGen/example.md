backend/tools/dtoTestDataGen/run.sh scan \
 | xargs -n 1 -I {} backend/tools/dtoTestDataGen/run.sh gen --dto {} --write --skip-no-fields --force
