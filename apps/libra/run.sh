#!/bin/bash
set -x
set -e

echo $0 $@

KMER_SIZE=20
NUM_TASKS=30
FILTER_ALG="NOTUNIQUE"
SCORING_ALG="COSINESIMILARITY"
WEIGHTING_ALG="LOGARITHM"

while getopts ":k:t:f:w:s:" opt; do
  case ${opt} in
    k ) KMER_SIZE=$OPTARG;;
    t ) NUM_TASKS=$OPTARG;;
    f ) FILTER_ALG=$OPTARG;;
    s ) SCORING_ALG=$OPTARG;;
    w ) WEIGHTING_ALG=$OPTARG;;
  esac
done
shift $(( OPTIND - 1 ))

JAVA_OPTS=""
CWD=$(dirname "$0")
TMP_DIR=$(dirname $CWD)
DONE_FILE=$TMP_DIR/job.done
JOB_ID=$(uuidgen)
HDFS_PATH=/user/mbomhoff/occ/$JOB_ID

HDFS=/opt/hadoop/bin/hdfs
HADOOP=/opt/hadoop/bin/hadoop
LIBRA_DIR=/home/mbomhoff/repos/libra

echo "Started Staging Data" `date`

$HDFS dfs -mkdir -p $HDFS_PATH/data

for path in "$@"
do
    if [[ -d $path ]]; then
        filelist=`ls -d $path/*`
    else
        filelist=$path
    fi

    for f in $filelist
    do
        ext="${f##*.}"
        name="${f%.*}"

        if [[ "$ext" = "gz" || "$ext" = "gzip" ]]; then
            # mdb removed 9/25/18 -- too slow to convert to bzip2, just decompress
            #echo "Converting to bzip2" $f
            #gunzip --stdout $STAGING_PATH/$f | /home/mbomhoff/tmp/pbzip2-1.1.8/pbzip2 > $STAGING_PATH/$name.bz2
            gunzip $f
            f=$name
        fi

        $HDFS dfs -put -f $f $HDFS_PATH/data

        #rm $f
    done || exit 1
done || exit 1

echo "Finished Staging Data" `date`

echo "Started Libra" `date`

# Index
LIBRA_CMD="$HADOOP jar $LIBRA_DIR/dist/libra-all.jar $JAVA_OPTS preprocess \
-k $KMER_SIZE \
-t $NUM_TASKS \
-f $FILTER_ALG \
-o $HDFS_PATH/index \
$HDFS_PATH/data"

eval $LIBRA_CMD

# Analyze
LIBRA_CMD="$HADOOP jar $LIBRA_DIR/dist/libra-all.jar distancematrix \
-w $WEIGHTING_ALG \
-s $SCORING_ALG \
-o $HDFS_PATH/score \
$HDFS_PATH/index"

eval $LIBRA_CMD

# Get result
$HDFS dfs -get $HDFS_PATH/score $TMP_DIR/data

# Convert to distance & similarity matrices
python $LIBRA_DIR/tools/gen_score_matrix.py \
$TMP_DIR/data/score/result.score \
$TMP_DIR/data/score/file_mapping_table.json \
$TMP_DIR/data/score/similarity.matrix similarity

python $LIBRA_DIR/tools/gen_score_matrix.py \
$TMP_DIR/data/score/result.score \
$TMP_DIR/data/score/file_mapping_table.json \
$TMP_DIR/data/score/distance.matrix distance

touch $DONE_FILE

echo "Finished Libra" `date`