#!/bin/sh -ex

echo "Started Libra" `date`

JOB_ID=$1
IN_DIR=$2
KMER_SIZE=$3
NUM_TASKS=$4
FILTER_ALG=$5
RUN_MODE=$6
WEIGHTING_ALG=$7
SCORING_ALG=$8

TMP_DIR=/tmp/occ
DONE_FILE=$TMP_DIR/$JOB_ID.done
OUT_DIR=/user/mbomhoff/occ
LIBRA_DIR=/home/mbomhoff/repos/libra

JAVA_OPTS="-D mapred.child.java.opts=-Xmx32768M -D mapreduce.reduce.shuffle.input.buffer.percent=0.20 -D yarn.scheduler.minimum-allocation-mb=4096 -D mapreduce.map.memory.mb=2048 -D mapreduce.reduce.memory.mb=2048"

# Index
LIBRA_CMD="hadoop jar $LIBRA_DIR/dist/libra-all.jar $JAVA_OPTS preprocess \
-k $KMER_SIZE \
-t $NUM_TASKS \
-f $FILTER_ALG \
-o $OUT_DIR/$JOB_ID/index \
$IN_DIR"

echo $LIBRA_CMD
eval $LIBRA_CMD

# Analyze
LIBRA_CMD="hadoop jar $LIBRA_DIR/dist/libra-all.jar distancematrix \
-m $RUN_MODE \
-w $WEIGHTING_ALG \
-s $SCORING_ALG \
-t $NUM_TASKS \
-o $OUT_DIR/$JOB_ID/score \
$OUT_DIR/$JOB_ID/index"

echo $LIBRA_CMD
eval $LIBRA_CMD

# Get result
#hdfs dfs -get $OUT_DIR/$JOB_ID/index $TMP_DIR/$JOB_ID/index # mdb removed 2/4/18 because it can fill up TMP_DIR
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

echo "Finished Libra" `date`
