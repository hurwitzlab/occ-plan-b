JOB_ID=$1
IN_DIR=$2
KMER_SIZE=$3
NUM_TASKS=$4
FILTER_ALG=$5
RUN_MODE=$6
WEIGHTING_ALG=$7

MEM=32768M
TMP_DIR=/tmp/occ
LOG_FILE=$TMP_DIR/occ.log
DONE_FILE=$TMP_DIR/$JOB_ID.done
OUT_DIR=/user/mbomhoff/occ
LIBRA_DIR=/home/mbomhoff/repos/libra

# Index
hadoop jar $LIBRA_DIR/dist/libra-all.jar -D mapred.child.java.opts=-Xmx$MEM preprocess \
-k $3 \
-t $4 \
-f $5 \
-o $OUT_DIR/$JOB_ID/index \
$IN_DIR 2>&1 >> $LOG_FILE

# Analyze
hadoop jar $LIBRA_DIR/dist/libra-all.jar core \
-m $RUN_MODE \
-w $WEIGHTING_ALG \
-t $NUM_TASKS \
-o $OUT_DIR/$JOB_ID/score \
$OUT_DIR/$JOB_ID/index 2>&1 >> $LOG_FILE

# Get result
hdfs dfs -get $OUT_DIR/$JOB_ID/score $TMP_DIR/$JOB_ID/score

# Convert to distance & similarity matrices
python $LIBRA_DIR/tools/gen_score_matrix.py \
$TMP_DIR/$JOB_ID/score/result.score \
$TMP_DIR/$JOB_ID/score/file_mapping_table.json \
$TMP_DIR/$JOB_ID/score/similarity.matrix similarity

python $LIBRA_DIR/tools/gen_score_matrix.py \
$TMP_DIR/$JOB_ID/score/result.score \
$TMP_DIR/$JOB_ID/score/file_mapping_table.json \
$TMP_DIR/$JOB_ID/score/distance.matrix distance

touch $DONE_FILE